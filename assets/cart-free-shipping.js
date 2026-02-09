(function () {
  let updateTimeout = null;
  let isUpdating = false;
  let gapAddCache = null; // Cache for product recommendations
  let gapAddCacheHasEverMatched = false; // Tracks if cache has produced a match
  let gapAddRenderToken = 0; // Guards against stale async renders
  let selectedProduct = null; // Track currently selected recommendation product
  let selectedVariantId = null; // Track currently selected recommendation variant ID
  const THRESHOLD = 15000; // $150.00 in cents
  const DEBOUNCE_MS = 200;
  // Note: Removed MAX_REMAINING_CENTS - recommendations now show at any cart total
  
  // ============================================================================
  // CONFIGURATION: Collection handle for gap-add recommendations
  // Uses automated "in-stock" collection (no manual tagging required)
  // ============================================================================
  const GAP_ADD_COLLECTION_HANDLE = 'all';
  const GAP_ADD_COLLECTION_LIMIT = 250;
  const GAP_ADD_MAX_PAGES = 4;
  const GAP_ADD_FETCH_CONCURRENCY = 8;
  const GAP_ADD_FETCH_RETRY = 1; // Single retry on failed product.js fetch
  const GAP_ADD_CACHE_MIN_PRODUCTS = 50;
  let gapAddPaginationSupported = true;

  function shouldGapAddDebug() {
    if (typeof Shopify !== 'undefined' && Shopify.designMode) {
      return true;
    }
    if (typeof window === 'undefined' || !window.location || !window.location.search) {
      return false;
    }
    return /[?&]sbGapDebug=1\b/.test(window.location.search);
  }

  function logGapAddSummary(summary) {
    if (!shouldGapAddDebug()) {
      return;
    }
    console.debug('[gap-add] Summary:', summary);
  }

  function formatMoneyFromCents(cents) {
    // Use Shopify.formatMoney if available (better for multi-currency), otherwise fallback
    if (typeof Shopify !== 'undefined' && Shopify.formatMoney) {
      return Shopify.formatMoney(cents, theme?.settings?.moneyFormat || '${{amount}}');
    }
    // Basic USD formatting fallback
    const dollars = (cents / 100);
    return dollars.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  }

  function normalizeVariantPriceToCents(price) {
    if (price === null || price === undefined) {
      return null;
    }
    if (typeof price === 'string') {
      const parsed = parseFloat(price);
      if (!Number.isFinite(parsed)) {
        return null;
      }
      return Math.round(parsed * 100);
    }
    if (typeof price === 'number') {
      if (!Number.isFinite(price)) {
        return null;
      }
      const hasDecimals = Math.round(price) !== price;
      const looksLikeDollars = price < 1000 && hasDecimals;
      if (looksLikeDollars) {
        return Math.round(price * 100);
      }
      return Math.round(price);
    }
    return null;
  }

  // Build list of all candidate variants from products, excluding items already in cart
  // Only include available variants with price > 0 (all prices in cents)
  function buildCandidateVariants(products, cartData, remainingCents) {
    const candidates = [];
    
    // Build set of product IDs and variant IDs already in cart for fast lookup
    const cartProductIds = new Set();
    const cartVariantIds = new Set();
    
    if (cartData && cartData.items && Array.isArray(cartData.items)) {
      for (const item of cartData.items) {
        if (item.product_id) {
          cartProductIds.add(item.product_id);
        }
        if (item.variant_id) {
          cartVariantIds.add(item.variant_id);
        }
      }
    }
    
    // Collect candidates without price filtering (selection happens later)
    for (const product of products) {
      if (!product || !product.variants || product.variants.length === 0) {
        continue;
      }
      
      // Skip if product is already in cart
      if (product.id && cartProductIds.has(product.id)) {
        continue;
      }
      
      for (const variant of product.variants) {
        const priceCents = variant._priceCents;
        const isAvailable = variant.available === true || variant.available === 'true';
        // Only include available variants with price > 0
        if (!isAvailable || typeof priceCents !== 'number' || Number.isNaN(priceCents) || priceCents <= 0) {
          continue;
        }
        
        // Skip if variant is already in cart
        if (variant.id && cartVariantIds.has(variant.id)) {
          continue;
        }
        
        candidates.push({
          product: product,
          variant: variant,
          price: priceCents // Normalized cents
        });
      }
    }
    
    return candidates;
  }

  function getGapAddEfficiencyParams(remainingCents) {
    const sweetBufferCents = remainingCents <= 5000 ? 1500 : 2500;
    const maxOvershootCents = remainingCents <= 6000 ? 6000 : 10000;
    const maxAcceptablePriceCents = remainingCents + maxOvershootCents;
    return { sweetBufferCents, maxOvershootCents, maxAcceptablePriceCents };
  }

  function pickLowestPriceCandidate(candidates) {
    if (!candidates || candidates.length === 0) {
      return null;
    }
    return candidates.reduce((best, current) => {
      if (current.price < best.price) {
        return current;
      }
      return best;
    });
  }

  // Find best closing variant using sweet-spot buffer and max acceptable cap
  function findBestFitVariant(candidates, remainingCents) {
    if (candidates.length === 0) {
      return null;
    }

    // Only consider candidates that can close the gap
    const closingCandidates = candidates.filter(c => c.price >= remainingCents);
    if (closingCandidates.length === 0) {
      return null;
    }

    const { sweetBufferCents, maxAcceptablePriceCents } = getGapAddEfficiencyParams(remainingCents);
    const sweetSpotCandidates = closingCandidates.filter(
      c => c.price <= (remainingCents + sweetBufferCents)
    );

    if (sweetSpotCandidates.length > 0) {
      return pickLowestPriceCandidate(sweetSpotCandidates);
    }

    const closingWithinCap = closingCandidates.filter(
      c => c.price <= maxAcceptablePriceCents
    );
    if (closingWithinCap.length === 0) {
      return null;
    }
    return pickLowestPriceCandidate(closingWithinCap);
  }

  function buildInCartFallbackRecommendation(remainingCents, cartData, maxOvershootCents) {
    if (!cartData || !Array.isArray(cartData.items) || cartData.items.length === 0) {
      return null;
    }

    const candidates = [];
    for (const item of cartData.items) {
      if (!item) {
        continue;
      }
      const variantId = item.variant_id || item.id;
      if (!variantId) {
        continue;
      }

      const quantity = typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1;
      let unitPriceCents = null;
      if (typeof item.final_price === 'number') {
        unitPriceCents = item.final_price;
      } else if (typeof item.price === 'number') {
        unitPriceCents = item.price;
      } else if (typeof item.final_line_price === 'number') {
        unitPriceCents = Math.round(item.final_line_price / quantity);
      } else if (typeof item.line_price === 'number') {
        unitPriceCents = Math.round(item.line_price / quantity);
      }

      if (!Number.isFinite(unitPriceCents) || unitPriceCents <= 0) {
        continue;
      }
      if (unitPriceCents < remainingCents) {
        continue;
      }
      if (typeof maxOvershootCents === 'number' && unitPriceCents > remainingCents + maxOvershootCents) {
        continue;
      }

      candidates.push({
        item,
        price: unitPriceCents,
        variantId
      });
    }

    if (candidates.length === 0) {
      return null;
    }

    const best = pickLowestPriceCandidate(candidates);
    const item = best.item;
    const variantId = best.variantId;

    let productTitle = item.product_title || item.title || 'Item';
    const variantTitle = item.variant_title || '';
    if (item.product_title && variantTitle && variantTitle !== 'Default Title') {
      productTitle = `${item.product_title} - ${variantTitle}`;
    }

    const featuredImage = item.image || (item.featured_image && item.featured_image.url) || null;
    const product = {
      id: item.product_id || null,
      handle: item.handle || null,
      title: productTitle,
      featured_image: featuredImage,
      variants: [
        {
          id: variantId,
          title: variantTitle || 'Default Title',
          _priceCents: best.price
        }
      ]
    };

    return {
      product,
      variant: product.variants[0],
      chosenPriceCents: best.price
    };
  }


  async function fetchProductJsonWithRetry(handle, retries = GAP_ADD_FETCH_RETRY) {
    const url = `/products/${handle}.js`;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (response.ok) {
          const product = await response.json();
          if (product && Array.isArray(product.variants)) {
            for (const variant of product.variants) {
              variant._priceCents = normalizeVariantPriceToCents(variant.price);
              if (variant.compare_at_price !== undefined && variant.compare_at_price !== null) {
                variant._compareAtPriceCents = normalizeVariantPriceToCents(variant.compare_at_price);
              }
            }
          }
          return product;
        }
      } catch (err) {
        // Retry once on network/parse failures
      }
    }
    return null;
  }

  async function fetchProductsByHandles(handles) {
    if (!handles || handles.length === 0) {
      return { validProducts: [], successCount: 0, failCount: 0 };
    }

    const results = new Array(handles.length);
    let successCount = 0;
    let failCount = 0;
    let currentIndex = 0;

    const worker = async () => {
      while (true) {
        const idx = currentIndex;
        currentIndex += 1;
        if (idx >= handles.length) {
          return;
        }
        const handle = handles[idx];
        const product = await fetchProductJsonWithRetry(handle);
        results[idx] = product;
        if (product) {
          successCount += 1;
        } else {
          failCount += 1;
        }
      }
    };

    const workerCount = Math.min(GAP_ADD_FETCH_CONCURRENCY, handles.length);
    const workers = [];
    for (let i = 0; i < workerCount; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    const validProducts = results.filter(p => p !== null && p.variants && p.variants.length > 0);
    return { validProducts, successCount, failCount };
  }

  async function fetchCollectionPageHandles(page) {
    if (!GAP_ADD_COLLECTION_HANDLE) {
      return { handles: [], count: 0, error: true };
    }

    try {
      const collectionUrl = `/collections/${GAP_ADD_COLLECTION_HANDLE}/products.json?limit=${GAP_ADD_COLLECTION_LIMIT}&page=${page}`;
      const response = await fetch(collectionUrl, { credentials: 'same-origin' });

      if (!response.ok) {
        if (typeof Shopify !== 'undefined' && Shopify.designMode) {
          console.warn('[gap-add] Collection not found or error:', response.status, GAP_ADD_COLLECTION_HANDLE);
        }
        return { handles: [], count: 0, error: true };
      }

      const data = await response.json();
      const products = Array.isArray(data.products) ? data.products : [];
      const handles = products.map(p => p.handle).filter(Boolean);

      if (products.length === 0 && page === 1) {
        if (typeof Shopify !== 'undefined' && Shopify.designMode) {
          console.warn('[gap-add] Collection is empty:', GAP_ADD_COLLECTION_HANDLE);
        }
      }

      return { handles: handles, count: products.length, error: false };
    } catch (err) {
      if (typeof Shopify !== 'undefined' && Shopify.designMode) {
        console.error('[gap-add] Collection fetch failed', err);
      }
      return { handles: [], count: 0, error: true };
    }
  }

  function evaluateRecommendation(products, remainingCents, cartData) {
    const candidates = buildCandidateVariants(products, cartData, remainingCents);
    const closingCandidatesCount = candidates.filter(c => c.price >= remainingCents).length;
    const candidatePriceSampleCents = candidates.slice(0, 3).map(c => c.price);
    const bestCandidate = findBestFitVariant(candidates, remainingCents);
    return {
      bestCandidate,
      candidatesCount: candidates.length,
      closingCandidatesCount,
      candidatePriceSampleCents
    };
  }

  // Find best-fit recommendation using a closing variant (price >= remaining)
  // Filters out items already in cart
  async function findBestRecommendation(remainingCents, cartData) {
    // Only gate on remaining <= 0 (free shipping unlocked)
    // Removed upper bound - recommendations show at any cart total
    if (remainingCents <= 0) {
      return null;
    }

    const { maxOvershootCents } = getGapAddEfficiencyParams(remainingCents);
    let cacheSize = Array.isArray(gapAddCache) ? gapAddCache.length : 0;
    let cacheUsed = false;
    let recommendationSource = 'none';
    let chosenPriceCents = null;

    const logDecisionSummary = () => {
      logGapAddSummary({
        poolHandleUsed: GAP_ADD_COLLECTION_HANDLE,
        recommendationSource: recommendationSource,
        remainingCents: remainingCents,
        chosenPriceCents: typeof chosenPriceCents === 'number' ? chosenPriceCents : null,
        cacheUsed: cacheUsed,
        cacheSize: cacheSize
      });
    };

    const canUseCache = cacheSize >= GAP_ADD_CACHE_MIN_PRODUCTS && gapAddCacheHasEverMatched;

    // Try cached products first (guarded by size + prior match)
    if (canUseCache) {
      const cachedEval = evaluateRecommendation(gapAddCache, remainingCents, cartData);
      if (shouldGapAddDebug()) {
        logGapAddSummary({
          source: 'cache',
          validProductsTotal: gapAddCache.length,
          candidatesCount: cachedEval.candidatesCount,
          closingCandidatesCount: cachedEval.closingCandidatesCount,
          recommendationFound: !!cachedEval.bestCandidate,
          candidatePriceSampleCents: cachedEval.candidatePriceSampleCents
        });
      }
      if (cachedEval.bestCandidate) {
        gapAddCacheHasEverMatched = true;
        cacheUsed = true;
        recommendationSource = 'not-in-cart';
        chosenPriceCents = cachedEval.bestCandidate.price;
        logDecisionSummary();
        return {
          product: cachedEval.bestCandidate.product,
          variant: cachedEval.bestCandidate.variant,
          recommendationSource,
          chosenPriceCents
        };
      }
      gapAddCacheHasEverMatched = false;
    }

    const maxPages = gapAddPaginationSupported ? GAP_ADD_MAX_PAGES : 1;
    const seenHandles = new Set();
    const accumulatedProducts = [];
    let bestCandidate = null;
    let foundOnPage = null;

    for (let page = 1; page <= maxPages; page++) {
      const pageData = await fetchCollectionPageHandles(page);
      if (pageData.error) {
        break;
      }

      if (pageData.count === 0) {
        if (shouldGapAddDebug()) {
          const evaluation = evaluateRecommendation(accumulatedProducts, remainingCents, cartData);
          logGapAddSummary({
            page: page,
            productsJsonCount: 0,
            productJsSuccess: 0,
            productJsFail: 0,
            validProductsTotal: accumulatedProducts.length,
            candidatesCount: evaluation.candidatesCount,
            closingCandidatesCount: evaluation.closingCandidatesCount,
            recommendationFound: !!evaluation.bestCandidate,
            candidatePriceSampleCents: evaluation.candidatePriceSampleCents
          });
        }
        break;
      }

      const newHandles = pageData.handles.filter(h => !seenHandles.has(h));
      if (page > 1 && pageData.handles.length > 0 && newHandles.length === 0) {
        gapAddPaginationSupported = false;
        if (typeof Shopify !== 'undefined' && Shopify.designMode) {
          console.warn('[gap-add] Pagination not supported for collections JSON; falling back to first page only.');
        }
        if (shouldGapAddDebug()) {
          const evaluation = evaluateRecommendation(accumulatedProducts, remainingCents, cartData);
          console.warn('[gap-add] Pagination not supported for collections JSON; falling back to first page only.');
          logGapAddSummary({
            page: page,
            productsJsonCount: pageData.count,
            productJsSuccess: 0,
            productJsFail: 0,
            validProductsTotal: accumulatedProducts.length,
            candidatesCount: evaluation.candidatesCount,
            closingCandidatesCount: evaluation.closingCandidatesCount,
            recommendationFound: !!evaluation.bestCandidate,
            candidatePriceSampleCents: evaluation.candidatePriceSampleCents,
            paginationUnsupported: true
          });
        }
        break;
      }

      newHandles.forEach(h => seenHandles.add(h));

      const pageFetch = await fetchProductsByHandles(newHandles);
      accumulatedProducts.push(...pageFetch.validProducts);

      const evaluation = evaluateRecommendation(accumulatedProducts, remainingCents, cartData);
      bestCandidate = evaluation.bestCandidate;

      logGapAddSummary({
        page: page,
        productsJsonCount: pageData.count,
        productJsSuccess: pageFetch.successCount,
        productJsFail: pageFetch.failCount,
        validProductsTotal: accumulatedProducts.length,
        candidatesCount: evaluation.candidatesCount,
        closingCandidatesCount: evaluation.closingCandidatesCount,
        recommendationFound: !!bestCandidate,
        candidatePriceSampleCents: evaluation.candidatePriceSampleCents
      });

      if (bestCandidate) {
        foundOnPage = page;
        if (accumulatedProducts.length >= GAP_ADD_CACHE_MIN_PRODUCTS) {
          gapAddCache = accumulatedProducts;
          gapAddCacheHasEverMatched = true;
          cacheSize = gapAddCache.length;
        }
        break;
      }
    }

    if (!bestCandidate) {
      if (shouldGapAddDebug()) {
        const evaluation = evaluateRecommendation(accumulatedProducts, remainingCents, cartData);
        logGapAddSummary({
          page: foundOnPage || 'none',
          recommendationFound: false,
          validProductsTotal: accumulatedProducts.length,
          candidatesCount: evaluation.candidatesCount,
          closingCandidatesCount: evaluation.closingCandidatesCount,
          candidatePriceSampleCents: evaluation.candidatePriceSampleCents
        });
      }
      if (accumulatedProducts.length >= GAP_ADD_CACHE_MIN_PRODUCTS) {
        gapAddCache = accumulatedProducts;
        gapAddCacheHasEverMatched = false;
        cacheSize = gapAddCache.length;
      }
      if (typeof Shopify !== 'undefined' && Shopify.designMode) {
        console.warn('[gap-add] No closing variants found for remaining:', remainingCents);
      }

      const inCartFallback = buildInCartFallbackRecommendation(remainingCents, cartData, maxOvershootCents);
      if (inCartFallback) {
        recommendationSource = 'in-cart-fallback';
        chosenPriceCents = inCartFallback.chosenPriceCents;
        logDecisionSummary();
        return {
          product: inCartFallback.product,
          variant: inCartFallback.variant,
          recommendationSource,
          chosenPriceCents
        };
      }

      recommendationSource = 'none';
      logDecisionSummary();
      return null;
    }

    if (typeof Shopify !== 'undefined' && Shopify.designMode) {
      const delta = bestCandidate.price - remainingCents;
      console.debug('[gap-add] Best-fit closing selected:', {
        product: bestCandidate.product.title,
        variantId: bestCandidate.variant.id,
        variantPrice: bestCandidate.price,
        remaining: remainingCents,
        delta: delta,
        closesGap: delta >= 0
      });
    }

    recommendationSource = 'not-in-cart';
    chosenPriceCents = bestCandidate.price;
    logDecisionSummary();
    return {
      product: bestCandidate.product,
      variant: bestCandidate.variant,
      recommendationSource,
      chosenPriceCents
    };
  }

  // Hide gap-add UI completely and clear all state
  // This must be synchronous and immediate to prevent race conditions
  function hideGapAdd(reason) {
    try {
      const drawer = document.getElementById('CartDrawer');
      if (!drawer) {
        return;
      }

      const gapAddEl = drawer.querySelector('[data-gap-add]');
      if (!gapAddEl) {
        return;
      }

      // CRITICAL: Hide the container FIRST (synchronously)
      // This prevents any visual flicker or bare button from appearing
      gapAddEl.hidden = true;
      gapAddEl.setAttribute('hidden', 'hidden'); // Ensure it's truly hidden

      // Clear all UI elements to prevent empty state
      const imageEl = gapAddEl.querySelector('[data-gap-image]');
      const titleEl = gapAddEl.querySelector('[data-gap-title]');
      const priceEl = gapAddEl.querySelector('[data-gap-price]');
      const btnEl = gapAddEl.querySelector('[data-gap-add-btn]');
      const errorEl = gapAddEl.querySelector('[data-gap-error]');

      // Clear content immediately
      if (imageEl) {
        imageEl.innerHTML = '';
      }
      if (titleEl) {
        titleEl.textContent = '';
      }
      if (priceEl) {
        priceEl.textContent = '';
      }
      
      // CRITICAL: Disable and clear button state to prevent bare button
      if (btnEl) {
        btnEl.disabled = true;
        btnEl.textContent = 'ADD';
        btnEl.removeAttribute('data-variant-id');
        btnEl.classList.remove('is-added'); // Clear success state
        // Also hide button via style as extra safety
        btnEl.style.display = 'none';
      }
      
      if (errorEl) {
        errorEl.hidden = true;
        errorEl.setAttribute('hidden', 'hidden');
        errorEl.textContent = '';
      }

      // Clear selected product/variant tracking
      selectedProduct = null;
      selectedVariantId = null;

      if (typeof Shopify !== 'undefined' && Shopify.designMode && reason) {
        console.debug('[gap-add] Hidden:', reason);
      }
    } catch (error) {
      // Fail silently but log in design mode
      if (typeof Shopify !== 'undefined' && Shopify.designMode) {
        console.warn('[gap-add] hideGapAdd error:', error);
      }
    }
  }

  // Ensure a lightweight hint element exists (for no-closing-variant fallback)
  function getGapAddHintElement(drawer) {
    const box = drawer.querySelector('.cart-free-ship');
    if (!box) {
      return null;
    }

    let hintEl = box.querySelector('[data-gap-hint]');
    if (!hintEl) {
      hintEl = document.createElement('div');
      hintEl.setAttribute('data-gap-hint', '');
      hintEl.style.cssText = 'font-size:12px;color:#6b7280;margin-top:6px;line-height:1.35;';
      hintEl.hidden = true;
      hintEl.setAttribute('hidden', 'hidden');

      const gapAddEl = box.querySelector('[data-gap-add]');
      if (gapAddEl && gapAddEl.parentNode) {
        gapAddEl.parentNode.insertBefore(hintEl, gapAddEl.nextSibling);
      } else {
        box.appendChild(hintEl);
      }
    }

    return hintEl;
  }

  function showGapAddHint(remainingCents) {
    if (!remainingCents || remainingCents <= 0) {
      hideGapAddHint();
      return;
    }

    const drawer = document.getElementById('CartDrawer');
    if (!drawer) {
      return;
    }

    const hintEl = getGapAddHintElement(drawer);
    if (!hintEl) {
      return;
    }

    const money = formatMoneyFromCents(remainingCents);
    hintEl.textContent = `Add any item ${money}+ to unlock free shipping.`;
    hintEl.hidden = false;
    hintEl.removeAttribute('hidden');
  }

  function hideGapAddHint() {
    const drawer = document.getElementById('CartDrawer');
    if (!drawer) {
      return;
    }

    const hintEl = drawer.querySelector('[data-gap-hint]');
    if (!hintEl) {
      return;
    }

    hintEl.hidden = true;
    hintEl.setAttribute('hidden', 'hidden');
    hintEl.textContent = '';
  }

  // Show gap-add UI with product data
  function showGapAdd(product, variant) {
    try {
      const drawer = document.getElementById('CartDrawer');
      if (!drawer) {
        return false;
      }

      const gapAddEl = drawer.querySelector('[data-gap-add]');
      if (!gapAddEl) {
        return false;
      }

      // Note: We don't check gapAddEl.hidden here because showGapAdd() is called
      // to UNHIDE the container when we have a valid recommendation.
      // The container may be hidden from a previous hideGapAdd() call, and that's expected.

      const imageEl = gapAddEl.querySelector('[data-gap-image]');
      const titleEl = gapAddEl.querySelector('[data-gap-title]');
      const priceEl = gapAddEl.querySelector('[data-gap-price]');
      const btnEl = gapAddEl.querySelector('[data-gap-add-btn]');
      const errorEl = gapAddEl.querySelector('[data-gap-error]');

      if (!titleEl || !priceEl || !btnEl) {
        return false;
      }

      // Hide any fallback hint when showing a real recommendation
      hideGapAddHint();

      // Validate variant ID
      if (!variant || !variant.id || variant.id <= 0) {
        if (typeof Shopify !== 'undefined' && Shopify.designMode) {
          console.error('[gap-add] Invalid variant in showGapAdd:', variant);
        }
        hideGapAdd('invalid variant');
        return false;
      }

      // Store selected product/variant for "already in cart" detection
      selectedProduct = product;
      selectedVariantId = variant.id;

      // Build display title
      let displayTitle = product.title;
      const hasMultipleVariants = product.variants && product.variants.length > 1;
      const variantTitle = variant.title || '';
      const isDefaultTitle = variantTitle === 'Default Title' || variantTitle === '';

      if (hasMultipleVariants && !isDefaultTitle) {
        displayTitle = `${product.title} - ${variantTitle}`;
      }

      // Update UI
      titleEl.textContent = displayTitle;
      priceEl.textContent = formatMoneyFromCents(variant._priceCents);

      // Update product image if available
      if (imageEl) {
        imageEl.innerHTML = '';
        if (product.featured_image) {
          const img = document.createElement('img');
          img.src = product.featured_image;
          img.alt = product.title;
          img.loading = 'lazy';
          img.style.cssText = 'width:50px;height:50px;object-fit:cover;border-radius:4px;';
          imageEl.appendChild(img);
        }
      }

      // Set variant ID and enable button
      btnEl.dataset.variantId = String(variant.id);
      btnEl.disabled = false;
      btnEl.textContent = 'ADD';
      // Ensure button is visible (undo any hide from hideGapAdd)
      btnEl.style.display = '';

      // Clear any error messages
      if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = '';
      }

      // Show the container
      gapAddEl.hidden = false;

      if (typeof Shopify !== 'undefined' && Shopify.designMode) {
        console.log('[gap-add] ✅ Showing recommendation:', {
          product: product.title,
          variantId: variant.id,
          price: formatMoneyFromCents(variant._priceCents)
        });
      }

      return true;
    } catch (error) {
      console.warn('[gap-add] showGapAdd error', error);
      hideGapAdd('error');
      return false;
    }
  }

  // Legacy render function - now calls showGapAdd
  // IMPORTANT: This is async, so it must re-check eligibility before showing
  function renderGapAdd(cartData, remainingCents, thresholdCents) {
    try {
      gapAddRenderToken += 1;
      const token = gapAddRenderToken;

      // Re-check eligibility before any async operations (defense against race conditions)
      if (!cartData || typeof cartData.total_price !== 'number') {
        hideGapAdd('invalid cart data in render');
        hideGapAddHint();
        return;
      }

      const cartTotalCents = Math.max(0, cartData.total_price);
      const threshold = thresholdCents || THRESHOLD;
      
      // CRITICAL: Double-check eligibility before fetching (cart may have changed)
      if (cartTotalCents >= threshold) {
        hideGapAdd('threshold met in render');
        hideGapAddHint();
        return;
      }

      const drawer = document.getElementById('CartDrawer');
      if (!drawer) return;

      // Re-query DOM fresh each time (drawer may have been rebuilt)
      const gapAddEl = drawer.querySelector('[data-gap-add]');
      if (!gapAddEl) return;

      const imageEl = gapAddEl.querySelector('[data-gap-image]');
      const titleEl = gapAddEl.querySelector('[data-gap-title]');
      const priceEl = gapAddEl.querySelector('[data-gap-price]');
      const btnEl = gapAddEl.querySelector('[data-gap-add-btn]');
      const errorEl = gapAddEl.querySelector('[data-gap-error]');

      if (!titleEl || !priceEl || !btnEl) return;

      // Safety check: only gate on remaining <= 0 (free shipping unlocked)
      // Removed upper bound - recommendations show at any cart total
      if (remainingCents <= 0) {
        hideGapAdd('free shipping unlocked in render');
        hideGapAddHint();
        return;
      }

      // Find recommendation (async) - Part A: Pass cartData to filter out cart items
      findBestRecommendation(remainingCents, cartData).then(recommendation => {
        if (token !== gapAddRenderToken) {
          if (shouldGapAddDebug()) {
            console.debug('[gap-add] discard stale result', { token, current: gapAddRenderToken });
          }
          return;
        }

        // Re-check eligibility AGAIN after async fetch (cart may have changed during fetch)
        if (!cartData || typeof cartData.total_price !== 'number') {
          hideGapAdd('cart data invalid after fetch');
          return;
        }

        const currentCartTotal = Math.max(0, cartData.total_price);
        const currentThreshold = thresholdCents || THRESHOLD;
        
        if (currentCartTotal >= currentThreshold) {
          hideGapAdd('threshold met after fetch');
          hideGapAddHint();
          return;
        }

        if (!recommendation || !recommendation.variant) {
          const currentDrawer = document.getElementById('CartDrawer');
          const currentGapAddEl = currentDrawer ? currentDrawer.querySelector('[data-gap-add]') : null;
          const currentHintEl = currentDrawer ? currentDrawer.querySelector('[data-gap-hint]') : null;
          const gapAddVisible = currentGapAddEl ? !currentGapAddEl.hidden : false;
          const hintVisible = currentHintEl ? !currentHintEl.hidden : false;

          if (hintVisible && !gapAddVisible) {
            showGapAddHint(remainingCents);
            return;
          }
          hideGapAdd('no closing recommendation found');
          showGapAddHint(remainingCents);
          return;
        }

        // Note: No need to check isRecommendedItemInCart here anymore since
        // findBestRecommendation now filters out cart items before selection

        const currentDrawer = document.getElementById('CartDrawer');
        const currentGapAddEl = currentDrawer ? currentDrawer.querySelector('[data-gap-add]') : null;
        const gapAddVisible = currentGapAddEl ? !currentGapAddEl.hidden : false;
        if (gapAddVisible && selectedVariantId && String(selectedVariantId) === String(recommendation.variant.id)) {
          if (shouldGapAddDebug()) {
            console.debug('[gap-add] skip render; recommendation unchanged', {
              variantId: recommendation.variant.id
            });
          }
          return;
        }

        // Use showGapAdd to render
        const success = showGapAdd(recommendation.product, recommendation.variant);
        if (!success) {
          hideGapAdd('showGapAdd failed');
        }
      }).catch((err) => {
        console.warn('[gap-add] failed to find recommendation', err);
        
        if (typeof Shopify !== 'undefined' && Shopify.designMode) {
          console.error('[gap-add] ❌ Failed to find recommendation:', {
            error: err,
            collectionHandle: GAP_ADD_COLLECTION_HANDLE,
            remainingCents: remainingCents
          });
        }
        
        hideGapAdd('recommendation fetch error');
        showGapAddHint(remainingCents);
      });
    } catch (error) {
      console.warn('[gap-add] render error', error);
      hideGapAdd('render error');
    }
  }

  // Legacy function name for backwards compatibility
  function updateGapAddRecommendation(cartData, remainingCents) {
    return renderGapAdd(cartData, remainingCents);
  }

  // Check if recommended product/variant is already in cart
  function isRecommendedItemInCart(cart) {
    if (!cart || !cart.items || !Array.isArray(cart.items)) {
      return false;
    }

    // Check if we have a selected product/variant to compare against
    if (!selectedVariantId && !selectedProduct) {
      return false;
    }

    // Check each cart item
    for (const item of cart.items) {
      // Match by variant ID (most reliable)
      if (selectedVariantId && item.variant_id && item.variant_id === selectedVariantId) {
        return true;
      }

      // Match by product ID
      if (selectedProduct && selectedProduct.id && item.product_id && item.product_id === selectedProduct.id) {
        return true;
      }

      // Match by product handle (fallback)
      if (selectedProduct && selectedProduct.handle && item.handle && item.handle === selectedProduct.handle) {
        return true;
      }
    }

    return false;
  }

  // Update free shipping progress bar and message
  function updateFreeShippingProgress(cartData) {
    try {
      const drawer = document.getElementById('CartDrawer');
      if (!drawer) {
        return false;
      }

      const box = drawer.querySelector('.cart-free-ship');
      if (!box) {
        return false;
      }

      const textEl = box.querySelector('[data-free-ship-text]');
      const fillEl = box.querySelector('[data-free-ship-fill]');
      const metaEl = box.querySelector('[data-free-ship-meta]');
      const flatRateEl = box.querySelector('[data-free-ship-flat-rate]');
      
      if (!textEl || !fillEl || !metaEl) {
        return false;
      }

      if (!cartData || typeof cartData.total_price !== 'number') {
        return false;
      }

      // Read threshold from DOM attribute (already in cents, e.g. "15000")
      const thresholdAttr = box.getAttribute('data-threshold');
      let thresholdCents = THRESHOLD; // Default fallback
      
      if (thresholdAttr) {
        const parsed = parseInt(thresholdAttr, 10);
        if (!isNaN(parsed) && parsed > 0) {
          thresholdCents = parsed; // Already in cents, no conversion needed
        }
      }

      // Read flat shipping from DOM attribute (already in cents, e.g. "699")
      const flatShippingAttr = box.getAttribute('data-flat-shipping');
      let flatShippingCents = 699; // Default fallback
      
      if (flatShippingAttr) {
        const parsed = parseInt(flatShippingAttr, 10);
        if (!isNaN(parsed) && parsed > 0) {
          flatShippingCents = parsed; // Already in cents, no conversion needed
        }
      }

      // cart.total_price is already in cents (from Shopify API)
      const cartTotalCents = Math.max(0, cartData.total_price);
      const remainingCents = Math.max(0, Math.min(thresholdCents, thresholdCents - cartTotalCents));
      const pct = Math.min(100, Math.max(0, Math.round((cartTotalCents / thresholdCents) * 100)));
      const eligible = cartTotalCents >= thresholdCents;

      // Update progress bar
      fillEl.style.width = (eligible ? 100 : pct) + '%';

      // Update main message
      if (eligible) {
        textEl.innerHTML = '✅ You\'ve unlocked free shipping.';
      } else if (remainingCents <= 1500 && remainingCents > 0) {
        // Near threshold: <= $15 remaining
        const money = formatMoneyFromCents(remainingCents);
        textEl.innerHTML = `Almost there — add <strong data-free-ship-remaining>${money}</strong> to unlock free shipping.`;
      } else {
        // Standard message for > $15 remaining
        const money = formatMoneyFromCents(remainingCents);
        textEl.innerHTML = `You're <strong data-free-ship-remaining>${money}</strong> away from free shipping.`;
      }

      // Update flat shipping message (show/hide based on eligibility)
      let flatRateElement = flatRateEl;
      
      if (eligible) {
        // When eligible, show secondary note about flat shipping for orders under $150
        if (!flatRateElement) {
          flatRateElement = document.createElement('div');
          flatRateElement.className = 'cart-free-ship__flat-rate cart-shipping-flat-note';
          flatRateElement.setAttribute('data-free-ship-flat-rate', '');
          // Insert after the text element and before the progress bar
          const barEl = box.querySelector('.cart-free-ship__bar');
          if (barEl && textEl) {
            barEl.parentNode.insertBefore(flatRateElement, barEl);
          } else {
            // Fallback: append to box
            box.appendChild(flatRateElement);
          }
        }
        const flatShippingMoney = formatMoneyFromCents(flatShippingCents);
        flatRateElement.textContent = `Orders under $150 ship for a flat ${flatShippingMoney}.`;
        flatRateElement.style.display = '';
      } else {
        // Show flat rate message when not eligible
        if (!flatRateElement) {
          flatRateElement = document.createElement('div');
          flatRateElement.className = 'cart-free-ship__flat-rate cart-shipping-flat-note';
          flatRateElement.setAttribute('data-free-ship-flat-rate', '');
          // Insert after the text element and before the progress bar
          const barEl = box.querySelector('.cart-free-ship__bar');
          if (barEl && textEl) {
            barEl.parentNode.insertBefore(flatRateElement, barEl);
          } else {
            // Fallback: append to box
            box.appendChild(flatRateElement);
          }
        }
        
        const flatShippingMoney = formatMoneyFromCents(flatShippingCents);
        flatRateElement.textContent = `Flat ${flatShippingMoney} shipping under $150.`;
        flatRateElement.style.display = '';
      }

      // Update meta microcopy
      if (eligible) {
        const flatShippingMoney = formatMoneyFromCents(flatShippingCents);
        metaEl.textContent = `Orders under $150 ship for a flat ${flatShippingMoney}.`;
      } else {
        metaEl.textContent = `Free shipping at $150 (after discounts).`;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  // Update gap-add UI (show/hide based on eligibility and cart state)
  function updateGapAddUI(cartData) {
    try {
      if (!cartData || typeof cartData.total_price !== 'number') {
        hideGapAdd('invalid cart data');
        hideGapAddHint();
        return false;
      }

      const drawer = document.getElementById('CartDrawer');
      if (!drawer) {
        return false;
      }

      const box = drawer.querySelector('.cart-free-ship');
      if (!box) {
        return false;
      }

      // Read threshold from DOM attribute (already in cents, e.g. "15000")
      const thresholdAttr = box.getAttribute('data-threshold');
      let thresholdCents = THRESHOLD; // Default fallback
      
      if (thresholdAttr) {
        const parsed = parseInt(thresholdAttr, 10);
        if (!isNaN(parsed) && parsed > 0) {
          thresholdCents = parsed; // Already in cents, no conversion needed
        }
      }

      // cart.total_price is already in cents (from Shopify API)
      const cartTotalCents = Math.max(0, cartData.total_price);
      const eligible = cartTotalCents >= thresholdCents;

      // CRITICAL: Hide immediately and synchronously if threshold is met
      // This must happen BEFORE any async operations
      if (eligible) {
        hideGapAdd('threshold met');
        hideGapAddHint();
        return true;
      }

      // Calculate remaining (in cents)
      const remainingCents = Math.max(0, Math.min(thresholdCents, thresholdCents - cartTotalCents));

      // Only gate on remaining <= 0 (free shipping unlocked)
      // Removed upper bound - recommendations show at any cart total
      if (remainingCents <= 0) {
        hideGapAdd('free shipping unlocked');
        hideGapAddHint();
        return true;
      }

      // Only fetch and render if all checks pass
      // Note: renderGapAdd now handles filtering out cart items internally
      renderGapAdd(cartData, remainingCents, thresholdCents);
      return true;
    } catch (error) {
      hideGapAdd('update error');
      return false;
    }
  }

  // Legacy function - now calls both update functions
  function updateDrawerFreeShipAndGapAdd(cartData) {
    const progressUpdated = updateFreeShippingProgress(cartData);
    const gapAddUpdated = updateGapAddUI(cartData);
    return progressUpdated || gapAddUpdated;
  }

  function fetchAndUpdateFreeShipping() {
    // Prevent concurrent updates
    if (isUpdating) return;
    isUpdating = true;

    // Fetch fresh cart data
    const cartUrl = (theme && theme.routes && theme.routes.cart) || '/cart.js';
    fetch(cartUrl, { credentials: 'same-origin' })
      .then(r => r.json())
      .then(cart => {
        // Update both free shipping progress and gap-add UI
        updateFreeShippingProgress(cart);
        updateGapAddUI(cart);
      })
      .catch(() => {})
      .finally(() => {
        isUpdating = false;
      });
  }

  // Debounced update function
  function debouncedUpdate() {
    if (updateTimeout) clearTimeout(updateTimeout);
    updateTimeout = setTimeout(fetchAndUpdateFreeShipping, DEBOUNCE_MS);
  }

  // Update with retry mechanism (waits for DOM to be ready)
  function updateWithRetry(cartData, maxRetries = 3) {
    let retries = 0;
    const tryUpdate = () => {
      const progressOk = updateFreeShippingProgress(cartData);
      const gapAddOk = updateGapAddUI(cartData);
      if (progressOk || gapAddOk) {
        return; // Success
      }
      retries++;
      if (retries < maxRetries) {
        // DOM might not be ready yet, retry after delay
        setTimeout(tryUpdate, 100);
      } else {
        // Fallback: fetch fresh data
        fetchAndUpdateFreeShipping();
      }
    };
    tryUpdate();
  }

  // Listen to theme's cart:updated event
  document.addEventListener('cart:updated', function(e) {
    // Use cart data from event if available
    if (e.detail && e.detail.cart) {
      const cart = e.detail.cart;
      // Update both free shipping progress and gap-add UI
      updateFreeShippingProgress(cart);
      updateGapAddUI(cart);
    } else {
      // Fallback: fetch fresh cart data
      debouncedUpdate();
    }
  });

  // MutationObserver: Watch for changes to drawer footer (where free shipping component lives)
  function setupMutationObserver() {
    const drawer = document.getElementById('CartDrawer');
    if (!drawer) return null;

    const footer = drawer.querySelector('.drawer__footer');
    if (!footer) return null;

    const obs = new MutationObserver((mutations) => {
      // Check if subtotal element was updated (indicates cart rebuild)
      let shouldUpdate = false;
      for (const m of mutations) {
        if (m.type === 'childList' || m.type === 'characterData') {
          // If subtotal changed or free shipping component was added/removed
          const target = m.target;
          if (target.closest && (
            target.closest('[data-subtotal]') ||
            target.closest('.cart-free-ship') ||
            target.closest('.drawer__footer')
          )) {
            shouldUpdate = true;
            break;
          }
        }
      }
      if (shouldUpdate) {
        debouncedUpdate();
      }
    });

    // Observe the footer and its children
    obs.observe(footer, {
      childList: true,
      subtree: true,
      characterData: true
    });

    return obs;
  }

  // Watch for subtotal changes (more specific than footer)
  function setupSubtotalObserver() {
    const drawer = document.getElementById('CartDrawer');
    if (!drawer) return null;

    const subtotalEl = drawer.querySelector('[data-subtotal]');
    if (!subtotalEl) return null;

    const obs = new MutationObserver(() => {
      // Subtotal changed, update free shipping
      debouncedUpdate();
    });

    obs.observe(subtotalEl, {
      childList: true,
      subtree: false,
      characterData: true
    });

    return obs;
  }

  // Hook into quantity button clicks directly (fallback)
  function setupQuantityButtonHooks() {
    document.addEventListener('click', (e) => {
      // Check if clicked element is a quantity +/- button
      const qtyBtn = e.target.closest('quantity-selector button, .js-qty__adjust, [data-qty-adjust]');
      if (qtyBtn && document.getElementById('CartDrawer')) {
        // Quantity button clicked in cart drawer
        debouncedUpdate();
      }
    }, true); // Use capture phase to catch early
  }

  // Hook into remove button clicks
  function setupRemoveButtonHooks() {
    document.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.cart__remove, [data-cart-remove], .js-cart-remove');
      if (removeBtn && document.getElementById('CartDrawer')) {
        debouncedUpdate();
      }
    }, true);
  }

  // Handle Add button click for gap-add recommendation (event delegation)
  function setupGapAddButtonHandler() {
    document.addEventListener('click', async function(e) {
      const btn = e.target.closest('[data-gap-add-btn]');
      if (!btn) return;

      // Prevent default and stop propagation
      e.preventDefault();
      e.stopPropagation();

      // Re-query DOM fresh (drawer may have been rebuilt)
      const drawer = document.getElementById('CartDrawer');
      if (!drawer) {
        console.warn('[gap-add] CartDrawer not found');
        return;
      }

      const gapAddEl = drawer.querySelector('[data-gap-add]');
      if (!gapAddEl) {
        console.warn('[gap-add] gap-add container not found');
        return;
      }

      // Re-query button to ensure we have fresh reference
      const freshBtn = gapAddEl.querySelector('[data-gap-add-btn]');
      if (!freshBtn) {
        console.warn('[gap-add] button not found in container');
        return;
      }

      let variantId = freshBtn.dataset.variantId;

      // If variant ID is missing, try to fetch recommendation
      if (!variantId) {
        console.debug('[gap-add] variant ID missing, fetching recommendation...');
        try {
          const cartUrl = (theme && theme.routes && theme.routes.cart) || '/cart.js';
          const cartResponse = await fetch(cartUrl, { credentials: 'same-origin' });
          const cart = await cartResponse.json();
          
          // Read threshold from DOM (same logic as updateGapAddUI)
          const box = drawer.querySelector('.cart-free-ship');
          const thresholdAttr = box ? box.getAttribute('data-threshold') : null;
          const thresholdCents = thresholdAttr ? parseInt(thresholdAttr, 10) : THRESHOLD;
          
          const cartTotalCents = Math.max(0, cart.total_price || 0);
          const eligible = cartTotalCents >= thresholdCents;
          
          // Don't re-render if threshold is met
          if (eligible) {
            hideGapAdd('threshold met in button handler');
            hideGapAddHint();
            return;
          }
          
          const remainingCents = Math.max(0, Math.min(thresholdCents, thresholdCents - cartTotalCents));
          
          // Removed upper bound check - recommendations show at any cart total
          if (remainingCents > 0) {
            const recommendation = await findBestRecommendation(remainingCents, cart);
            if (recommendation && recommendation.variant) {
              // Double-check eligibility before showing
              if (cartTotalCents >= thresholdCents) {
                hideGapAdd('threshold met after recommendation fetch');
                hideGapAddHint();
                return;
              }
              
              variantId = String(recommendation.variant.id);
              freshBtn.dataset.variantId = variantId;
              
              // Build display title (same logic as renderGapAdd)
              const { product, variant: recVariant } = recommendation;
              const hasMultipleVariants = product.variants && product.variants.length > 1;
              const variantTitle = recVariant.title || '';
              const isDefaultTitle = variantTitle === 'Default Title' || variantTitle === '';
              let displayTitle = product.title;
              if (hasMultipleVariants && !isDefaultTitle) {
                displayTitle = `${product.title} - ${variantTitle}`;
              }
              
              // Update UI with new structure
              const titleEl = gapAddEl.querySelector('[data-gap-title]');
              const priceEl = gapAddEl.querySelector('[data-gap-price]');
              if (titleEl) titleEl.textContent = displayTitle;
              if (priceEl) priceEl.textContent = formatMoneyFromCents(recVariant._priceCents);
              
              freshBtn.disabled = false; // Enable button
              freshBtn.style.display = ''; // Ensure button is visible
              hideGapAddHint();
            } else {
              hideGapAdd('no closing recommendation in button handler');
              showGapAddHint(remainingCents);
            }
          } else {
            hideGapAdd('remaining out of range in button handler');
            hideGapAddHint();
          }
        } catch (err) {
          console.warn('[gap-add] failed to fetch recommendation', err);
          showGapAddError(gapAddEl, 'Couldn\'t add item. Please try again.');
          return;
        }
      }

      if (!variantId) {
        console.warn('[gap-add] no variant ID available');
        if (typeof Shopify !== 'undefined' && Shopify.designMode) {
          console.error('[gap-add] ❌ No variant ID found. Check that products are configured correctly.');
        }
        showGapAddError(gapAddEl, 'Couldn\'t add item. Please try again.');
        return;
      }

      // Validate variant ID is a valid number
      const variantIdNum = parseInt(variantId, 10);
      if (isNaN(variantIdNum) || variantIdNum <= 0) {
        console.error('[gap-add] Invalid variant ID format', variantId);
        if (typeof Shopify !== 'undefined' && Shopify.designMode) {
          console.error('[gap-add] ❌ Variant ID must be a positive number. Got:', variantId);
        }
        showGapAddError(gapAddEl, 'Couldn\'t add item (invalid variant).');
        return;
      }

      console.debug('[gap-add] click', { variantId: variantIdNum });

      // Prevent double-clicks: ignore if button is already disabled or in progress
      if (freshBtn.disabled && (freshBtn.textContent === 'Adding...' || freshBtn.textContent === 'Added ✓')) {
        console.debug('[gap-add] ignoring click - already in progress');
        return;
      }

      // Disable button while adding
      freshBtn.disabled = true;
      const originalText = freshBtn.textContent;
      freshBtn.textContent = 'Adding...';
      freshBtn.classList.remove('is-added'); // Clear any previous success state

      // Hide any existing error message
      const errorEl = gapAddEl.querySelector('[data-gap-error]');
      if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = '';
      }

      try {
        // Add to cart
        const cartAddUrl = (theme && theme.routes && theme.routes.cartAdd) || '/cart/add.js';
        const payload = {
          id: variantIdNum, // Use validated numeric ID
          quantity: 1
        };
        
        console.debug('[gap-add] POST to', cartAddUrl, { payload });
        
        // Enhanced logging in design mode
        if (typeof Shopify !== 'undefined' && Shopify.designMode) {
          console.log('[gap-add] 🛒 Adding to cart:', {
            endpoint: cartAddUrl,
            variantId: variantId,
            payload: payload
          });
        }

        const response = await fetch(cartAddUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          credentials: 'same-origin',
          body: JSON.stringify(payload)
        });

        console.debug('[gap-add] response status', response.status);

        // Parse response robustly
        let responseData = null;
        try {
          responseData = await response.json();
        } catch (jsonErr) {
          // If JSON parse fails, try text
          const textData = await response.text();
          console.warn('[gap-add] response not JSON', textData);
          throw new Error('Invalid response from server');
        }

        if (!response.ok) {
          // Shopify error format: { status: 422, message: "...", description: "..." }
          const errorMessage = responseData.message || responseData.description || 'Failed to add item';
          const status = responseData.status || response.status;
          
          console.warn('[gap-add] add.js error', {
            status: status,
            message: errorMessage,
            fullResponse: responseData
          });
          
          // Enhanced error logging in design mode
          if (typeof Shopify !== 'undefined' && Shopify.designMode) {
            console.error('[gap-add] ❌ Add to cart failed:', {
              status: status,
              message: errorMessage,
              description: responseData.description,
              variantId: variantId,
              fullResponse: responseData
            });
          }

          // Create user-friendly error message
          let userMessage = 'Couldn\'t add item';
          if (errorMessage.toLowerCase().includes('sold out') || 
              errorMessage.toLowerCase().includes('out of stock') ||
              errorMessage.toLowerCase().includes('unavailable')) {
            userMessage = 'Couldn\'t add item (sold out)';
          } else if (errorMessage.toLowerCase().includes('invalid') || 
                     errorMessage.toLowerCase().includes('variant')) {
            userMessage = 'Couldn\'t add item (invalid variant)';
          } else if (errorMessage) {
            // Use first sentence of error message if it's short enough
            const shortMsg = errorMessage.split('.')[0].substring(0, 50);
            if (shortMsg.length < 50) {
              userMessage = `Couldn't add item (${shortMsg})`;
            }
          }

          showGapAddError(gapAddEl, userMessage);
          return;
        }

        console.debug('[gap-add] add.js response', responseData);
        
        // Enhanced logging in design mode
        if (typeof Shopify !== 'undefined' && Shopify.designMode) {
          console.log('[gap-add] ✅ Successfully added to cart:', {
            variantId: variantId,
            response: responseData
          });
        }

        // Show success state immediately
        showGapAddSuccess(gapAddEl);

        // Dispatch ajaxProduct:added event to trigger theme's cart rebuild (if theme uses it)
        document.dispatchEvent(new CustomEvent('ajaxProduct:added', {
          detail: {
            variant_id: variantId,
            quantity: 1,
            product: responseData
          }
        }));

        // Wait ~1 second to show confirmation, then update cart and hide upsell if needed
        setTimeout(async () => {
          try {
            // Fetch fresh cart data
            const cartUrl = (theme && theme.routes && theme.routes.cart) || '/cart.js';
            const cartResponse = await fetch(cartUrl, { credentials: 'same-origin' });
            const cart = await cartResponse.json();
            
            // Dispatch cart:updated event with fresh cart data (triggers theme rebuild + our listeners)
            document.dispatchEvent(new CustomEvent('cart:updated', {
              detail: { cart: cart }
            }));

            // Update UI (this will hide upsell if threshold met or item already in cart)
            updateFreeShippingProgress(cart);
            updateGapAddUI(cart);
          } catch (err) {
            console.warn('[gap-add] failed to update cart after success', err);
            // Fallback: just hide the upsell
            hideGapAdd('cart update failed after success');
          }
        }, 1000);

      } catch (err) {
        console.warn('[gap-add] failed', err);
        const errorMsg = err.message || 'Couldn\'t add item. Please try again.';
        showGapAddError(gapAddEl, errorMsg);
        
        // Re-enable button on failure only
        freshBtn.disabled = false;
        freshBtn.textContent = originalText;
        freshBtn.classList.remove('is-added');
      }
      // Note: On success, button stays in "Added ✓" state and upsell will be hidden by updateGapAddUI
    }, true); // Use capture phase for event delegation
  }

  // Show success state on gap-add button
  function showGapAddSuccess(container) {
    const btnEl = container.querySelector('[data-gap-add-btn]');
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = 'Added ✓';
      btnEl.classList.add('is-added');
    }
  }

  // Show error message in gap-add container
  function showGapAddError(container, message) {
    const errorEl = container.querySelector('[data-gap-error]');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    } else {
      // Fallback: create error element if missing
      const errorDiv = document.createElement('div');
      errorDiv.className = 'cart-gap-add__error';
      errorDiv.setAttribute('data-gap-error', '');
      errorDiv.textContent = message;
      errorDiv.style.cssText = 'font-size:12px;color:#dc2626;margin-top:4px;';
      container.appendChild(errorDiv);
    }
  }

  // Initialize on DOM ready
  function init() {
    // Update on initial load
    fetchAndUpdateFreeShipping();

    // Setup observers
    setupMutationObserver();
    setupSubtotalObserver();
    setupQuantityButtonHooks();
    setupRemoveButtonHooks();
    setupGapAddButtonHandler();

    // Update when drawer opens
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[href="/cart"], .site-nav__cart, .js-drawer-open-cart');
      if (btn) {
        setTimeout(fetchAndUpdateFreeShipping, 300);
      }
    });

    // Also listen for cart:build event (fires when cart should rebuild)
    document.addEventListener('cart:build', () => {
      debouncedUpdate();
    });
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
