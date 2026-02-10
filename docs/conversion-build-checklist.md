# Conversion Build Checklist (Mapped To Current Theme)

This checklist maps your approved conversion spec to the exact templates, sections, blocks, snippets, and assets in this theme.

Use this file as the implementation runbook.

## 0) Template Map (Current Live Structure)

1. Homepage template: `/Users/bschaffer/stonebrook/2-10-content/2-10-content/templates/index.json`
2. Sealed product template (PDP): `/Users/bschaffer/stonebrook/2-10-content/2-10-content/templates/product.product-sealed-pokemon.json`
3. New Arrivals collection template: `/Users/bschaffer/stonebrook/2-10-content/2-10-content/templates/collection.product-collection.json`
4. Cart drawer markup: `/Users/bschaffer/stonebrook/2-10-content/2-10-content/snippets/cart-drawer.liquid`
5. Cart drawer progress logic: `/Users/bschaffer/stonebrook/2-10-content/2-10-content/assets/cart-free-shipping.js`

## 1) Preflight Checklist

- [ ] Duplicate current theme in Shopify admin before any edits.
- [ ] Confirm this theme is using `cart_type = drawer` in `/Users/bschaffer/stonebrook/2-10-content/2-10-content/config/settings_data.json`.
- [ ] In Theme Editor, confirm the following template assignments are active:
`index`, `product.product-sealed-pokemon`, `collection.product-collection`.
- [ ] Record baseline metrics before launch changes:
Sessions, add-to-cart rate, cart-to-checkout rate, purchase conversion rate, mobile conversion rate.

## 2) Global Copy Canon (Single Source Of Truth)

Target token values:

1. `FREE_SHIPPING_THRESHOLD`: `Free shipping at $150+`
2. `BASE_SHIPPING`: `Flat $6.99 shipping under $150`
3. `SHIP_SPEED`: `Ships in 1-2 business days`
4. `SHIP_ORIGIN`: `Shipped from Maryland`
5. `AUTH_GUARANTEE`: `Authentic & factory sealed`
6. `DAMAGE_POLICY`: `Damaged/incorrect delivery support within 48 hours`
7. `TRUST_PROOF`: `500+ TCGplayer orders, 100% positive`

Implementation checklist:

- [ ] Update all hardcoded copies in:
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/templates/index.json`
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/templates/product.product-sealed-pokemon.json`
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/templates/collection.product-collection.json`
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/sections/header-group.json`
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/snippets/collection-grid.liquid`
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/snippets/cart-drawer.liquid`
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/assets/cart-free-shipping.js`
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/sections/stonebrook-split-hero.liquid`
- [ ] Ensure punctuation and capitalization match everywhere.
- [ ] Ensure `$150+` and `$6.99` never drift between templates.

Implementation note:
Theme Editor can change JSON template strings, but repeated hardcoded text in Liquid and JS still requires code edits.

## 3) Header Announcement Bar

Theme Editor target:
Header Group -> section `announcement` (type `announcement`) in `/Users/bschaffer/stonebrook/2-10-content/2-10-content/sections/header-group.json`.

Current blocks:
`announcement_shipping_over`, `announcement_shipping_flat`, `announcement_speed`, `announcement_trust`.

Checklist:

- [ ] Replace rotating multi-message bar with one consolidated message.
- [ ] Keep one block only (recommended: `announcement_shipping_over`).
- [ ] Set block text to:
`Factory-sealed only - Ships in 1-2 business days - Free shipping $150+`.
- [ ] Remove or disable the other three announcement blocks.
- [ ] Keep `announcement_compact = true`.

Done when:
Top bar shows one stable reassurance line on desktop and mobile.

## 4) Homepage Build Checklist

Template: `/Users/bschaffer/stonebrook/2-10-content/2-10-content/templates/index.json`

### 4.1 Hero Section

Section ID/type:
`stonebrook_split_hero` / `stonebrook-split-hero`

Files:
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/templates/index.json`
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/sections/stonebrook-split-hero.liquid`

Checklist:

- [ ] Update hero settings in Theme Editor:
`heading`, `subheading`, `microcopy`, `primary_label`, `primary_link`, `secondary_label`, `secondary_link`, `tertiary_label`, `tertiary_link`.
- [ ] Set copy to:
Heading: `Factory-Sealed Pokemon & One Piece. Shipped Fast from Maryland.`
Subheading: `Authentic sealed product for collectors and players.`
Microcopy: `Flat $6.99 shipping under $150 - Free shipping at $150+`
Primary CTA: `Shop New Arrivals` -> `/collections/new-arrivals`
Secondary CTA: `Shop Best Sellers` -> `/collections/best-pokemon-picks`
Tertiary CTA: blank.
- [ ] Update trust item blocks under `stonebrook_split_hero.blocks` to only non-duplicative proof lines:
`Support for damaged/incorrect delivery within 48 hours`
`500+ TCGplayer orders, 100% positive`
- [ ] Keep value-strip pills in sync with global copy.

Implementation note:
The value-strip pills are hardcoded in `/Users/bschaffer/stonebrook/2-10-content/2-10-content/sections/stonebrook-split-hero.liquid` and are not fully Theme Editor-driven.

### 4.2 Section Order Cleanup

Section order currently in `index.json`:
`stonebrook_split_hero`, `featured-collection`, `featured_collection_yeHVTB`, `featured-collections`, `apps`, `trusted_seller_proof`, `text_with_icons_zVMtFd`, `faq_home_conversion`.

Checklist:

- [ ] Reorder for decision flow:
Hero -> Shop By Category -> Best Sellers -> New Arrivals -> Trusted Seller Proof -> Why Stonebrook -> FAQ -> Testimonials app.
- [ ] Keep only one trust-proof section and one FAQ section.

### 4.3 Shop By Category

Section ID/type:
`featured-collections` / `featured-collections`

Checklist:

- [ ] Keep title as `Shop By Category`.
- [ ] Keep four active blocks:
`collection-4`, `collection-1`, `collection_X94khD`, `collection-2`.
- [ ] Ensure category labels are explicit and consistent:
`All Pokemon`, `Japanese Pokemon`, `English Pokemon`, `One Piece`.

### 4.4 Best Sellers + New Arrivals

Section IDs/types:
`featured-collection` (Best Sellers), `featured_collection_yeHVTB` (New Arrivals), both type `featured-collection`.

Checklist:

- [ ] `featured-collection` title: `Best Sellers`.
- [ ] `featured-collection` subheading: `Most purchased sealed picks from recent orders.`
- [ ] `featured_collection_yeHVTB` title: `New Arrivals`.
- [ ] `featured_collection_yeHVTB` subheading: `Fresh inventory added regularly - grab the newest sealed product.`
- [ ] Keep `trust_badge_text = Factory sealed`.
- [ ] Keep `view_all = true`.

### 4.5 Trusted Seller Proof

Section ID/type:
`trusted_seller_proof` / `trusted-seller-proof`

Checklist:

- [ ] Title: `Trusted Seller - 500+ TCGplayer Orders`
- [ ] Chips:
`stat_1 = 500+ orders`
`stat_2 = 100% positive`
`stat_3 = Maryland`
- [ ] Body bullets:
`100% positive feedback`
`Fast handling from Maryland`
`Factory sealed only (no reseals)`
- [ ] CTA label/link:
`View TCGplayer Profile` -> seller URL.

### 4.6 Why Stonebrook Section

Section ID/type:
`text_with_icons_zVMtFd` / `text-with-icons`

Checklist:

- [ ] Keep as the only process/value section.
- [ ] Keep 3 to 4 `text_block` cards max.
- [ ] Remove any messaging duplicated verbatim in hero + trusted seller + FAQ.
- [ ] Keep one CTA only (`button_label`, `button_link`).

### 4.7 Homepage FAQ

Section ID/type:
`faq_home_conversion` / `faq`

Checklist:

- [ ] Keep section title as `Before you order`.
- [ ] Keep only four question blocks:
`question_authenticity`, `question_ship_time`, `question_shipping_rates`, `question_returns`.
- [ ] Remove `question_help_choosing`.
- [ ] Ensure answer copy exactly matches global copy canon.

## 5) Product Page (Sealed PDP) Checklist

Template:
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/templates/product.product-sealed-pokemon.json`

Main section:
`main` type `main-product-sealed-pokemon`

Renderer:
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/snippets/product-template.liquid`

### 5.1 Block Order + Above-The-Fold Content

Current high-impact blocks:
`price`
`quantity_selector_primary`
`buy_buttons`
`inventory_status_primary`
`text_cta_proof`
`text_mLcnTC`
`text_support_help`
`tab_6WX4hU`
`tab`
`tab_qXWtq4`
`description`

Checklist:

- [ ] Keep buy-decision order exactly:
Price -> Quantity -> Buy buttons -> Inventory -> Trust bullets -> Shipping/cost note -> Contact support line -> Policy tabs -> Description.
- [ ] Remove `text_before_order_note` if present in block order.
- [ ] Keep dynamic checkout enabled only if brand strategy requires Shop Pay express prominence.

### 5.2 Trust + Cost Certainty Copy

Blocks in `product.product-sealed-pokemon.json`:
`text_cta_proof`, `text_mLcnTC`, `text_support_help`.

Checklist:

- [ ] `text_cta_proof` content should include four lines:
`Authentic & factory sealed`
`Ships in 1-2 business days from Maryland`
`Flat $6.99 shipping under $150 - Free shipping at $150+`
`Damaged/incorrect delivery support within 48 hours`
- [ ] `text_mLcnTC` should be:
`Shipping and taxes are calculated at checkout. Free shipping unlocks at $150+.`
- [ ] `text_support_help` should stay:
`Need help choosing? Contact us before checkout.`

Implementation note:
`text_cta_proof` currently uses custom HTML inside block text; preserve wrapper class `sb-sealed-cta-proof`.

### 5.3 Inventory + Low Stock Language

Files:
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/snippets/product-inventory.liquid`
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/locales/en.default.json`

Checklist:

- [ ] Keep locale strings:
`in_stock_label = In stock, ready to ship`
`stock_label.one = Low stock - {{ count }} item left`
`stock_label.other = Low stock - {{ count }} items left`
- [ ] Keep inventory threshold in block `inventory_status_primary.settings.inventory_threshold` aligned to your replenishment strategy.

### 5.4 Shipping Progress Copy Sync

Files:
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/sections/main-product-sealed-pokemon.liquid`

Checklist:

- [ ] Update JS-generated shipping text in `updateShippingProgress()` to match global canon and cart-drawer wording.
- [ ] Remove any phrase not in canon (for example ad-hoc phrasing like "Add a low-cost item") unless intentionally retained.

### 5.5 Policy Accordions

Blocks:
`tab_6WX4hU`, `tab`, `tab_qXWtq4`.

Checklist:

- [ ] Titles must be:
`Shipping information`
`Returns & Refunds`
`Authenticity`
- [ ] Shipping tab: include ship speed + tracking trigger.
- [ ] Returns tab: include damage/incorrect scope + 48-hour requirement + opened item exclusion.
- [ ] Authenticity tab: include factory-sealed statement and reseal policy.

### 5.6 Product Recommendations

Section:
`product-recommendations` type `product-recommendations`.

Checklist:

- [ ] Heading setting `product_recommendations_heading = You may also like`.
- [ ] Keep `related_count = 4 or 5` for mobile scannability.
- [ ] Keep `products_per_row = 4 desktop` and validate mobile overflow readability.

### 5.7 Mobile Sticky ATC vs Cart Drawer Collision

Files:
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/sections/main-product-sealed-pokemon.liquid`
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/assets/sb-global.css`

Checklist:

- [ ] Add rule/logic so sticky PDP ATC hides whenever cart drawer is open.
- [ ] Trigger condition should use existing drawer state class (`js-drawer-open` and/or `#CartDrawer.drawer--is-open`).
- [ ] Verify no overlap on iPhone viewport with drawer footer buttons.

## 6) Collection Template (New Arrivals) Checklist

Template:
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/templates/collection.product-collection.json`

Primary files:
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/sections/collection-header.liquid`
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/sections/main-collection.liquid`
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/snippets/collection-grid.liquid`
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/snippets/product-grid-item.liquid`

### 6.1 Collection Hero

Checklist:

- [ ] Keep dark hero style for `template.suffix == product-collection`.
- [ ] Ensure chips remain concise and proof-based:
`Factory sealed`
`Ships fast from the U.S.`
`Packed with care`
- [ ] Add meta line near title (code update) with:
`{{ collection.products_count }} items - Free shipping at $150+`.

Implementation note:
Chip list is hardcoded in `collection-header.liquid` via `collection_chip_list`.

### 6.2 Filter + Sort Bar

Checklist:

- [ ] Keep sticky filter/sort behavior on mobile (`main-collection` already supports this).
- [ ] Keep summary line in `collection-grid.liquid`:
`{{ count }} items - Free shipping at $150+`.
- [ ] Ensure enabled filters in Search and Discovery app include:
Availability, Price, Category, Language, Product type.
- [ ] Keep sort enabled (`main-collection.settings.enable_sort = true`).

Implementation note:
Sort options are Shopify-native (`collection.sort_options`); "Top rated" is not native without custom ranking logic.

### 6.3 Product Card Content Density

File:
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/snippets/product-grid-item.liquid`

Checklist:

- [ ] Keep title (2-line clamp), price, and Judge.me rating visible.
- [ ] Add one metadata microline under title for `Language - Set` using product metafields.
- [ ] Keep restock/sold-out tags.
- [ ] Add explicit in-stock badge only if inventory > 0 and product available.
- [ ] Add quick add button for single-variant products (code change), fallback to PDP for multi-variant products.

### 6.4 Collection About + FAQ

Sections:
`main-collection` block `collection_description`
`collection_buy_confidence` type `faq`

Checklist:

- [ ] Set collection description to one concise trust paragraph and keep mobile `Read more`.
- [ ] In collection FAQ keep only four question blocks and remove `question_help_choosing`.
- [ ] Keep FAQ answers aligned with homepage and PDP wording.

## 7) Cart Drawer Checklist

Files:
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/snippets/cart-drawer.liquid`
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/assets/cart-free-shipping.js`
`/Users/bschaffer/stonebrook/2-10-content/2-10-content/assets/sb-global.css`

### 7.1 Message Hierarchy + Certainty Copy

Checklist:

- [ ] Keep this order:
Item list -> subtotal -> free shipping progress -> taxes/shipping note -> checkout CTA -> secondary view-cart -> trust/support notes.
- [ ] Standardize message states in both Liquid and JS:
Below threshold: `You're $X away from free shipping.`
Unlocked: `Free shipping unlocked. You're set for free shipping on this order.`
Flat-rate helper: `Flat $6.99 shipping under $150.`
Meta line: `Free shipping at $150 (after discounts).`
- [ ] Keep checkout microcopy:
`Secure checkout. Shipping and taxes shown next.`

### 7.2 Quantity + Optional Add-on

Checklist:

- [ ] Keep +/- quantity controls and immediate subtotal refresh.
- [ ] Keep optional add-on area below progress, but ensure it never outranks checkout CTA visually.

### 7.3 Header + CTA Integrity

Checklist:

- [ ] Optionally update title to include item count:
`Cart ({{ cart.item_count }})` with JS sync after updates.
- [ ] Keep primary CTA label as `Check out`.
- [ ] Keep secondary CTA `View cart`.

## 8) QA Checklist (Desktop + Mobile)

- [ ] Homepage hero, trust, and FAQ show no duplicate claims.
- [ ] PDP above-the-fold includes price, stock state, trust bullets, shipping certainty, and primary CTA without accordion interaction.
- [ ] Collection cards are scannable with enough metadata to decide quickly.
- [ ] Cart drawer copy matches PDP shipping logic exactly.
- [ ] Mobile cart drawer opens without sticky ATC overlap.
- [ ] No clipped text in CTA buttons at 320px width.
- [ ] No wording mismatch for shipping threshold or policy windows.

## 9) Launch Gate (Ready To Implement)

- [ ] All checklist items in sections 2 through 8 completed.
- [ ] Final pass performed in Theme Editor preview for:
Homepage, one sealed PDP, New Arrivals collection, cart drawer.
- [ ] Theme published only after mobile viewport validation (iOS Safari + Chrome Android width simulation).
