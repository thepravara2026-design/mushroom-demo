## Session Summary (Jun 26, 2026)

### What was built / refactored

**1. Premium Product Modal (`premium-modal` in `app.js` + `style.css`)**
- Full-screen frosted modal triggered from shop/section/landing cards
- Left gallery (carousel with thumbnails), right info pane (name, price/MRP/discount, variant chips, buy buttons)
- Keyboard (Escape) + click-outside dismiss
- Premium animation classes (`.ppm-enter`, `.ppm-enter-active`) with staggered children

**2. Premium Modal CSS (added to `style.css`)**
- `.ppm-overlay` — frosted glass backdrop
- `.ppm-modal` — max-width 1000px, rounded corners, slide-down entrance
- `.ppm-gallery` — flex gallery with rounded image, thumbnail strip, carousel nav
- `.ppm-info` — multi-column price row with MRP/discount/badge, variant chips, quantity + add-to-cart
- Animations: price flash, qty pop, chip ripple, staggered entrance

**3. Admin Edit/Add Form Redesign (in `app.js` admin section + `style.css`)**
- Replaced dense table with premium card-based sections (`section-card`)
- Mandatory MRP toggle: when toggled on, MRP fields appear; price must be <= MRP (server-enforced)
- Image zone with drop-to-reorder (drag-and-drop), single/featured/double layout within a bordered zone
- Better empty state: "No images yet — upload at least one image above"
- Upload progress bar: linear gradient fill during uploads
- Product images upload panel: bordered drop zone, circular remove buttons, drag-to-reorder functionality per product variant

**4. Admin Add/Edit CSS (added `style.css`)**
- `.section-card` — gradient header, bordered content area
- `.mrp-toggle`, `.img-zone`, `.img-upload-area` — custom toggle switch, drop zone, upload area
- `.upload-progress-bar` — animated gradient fill
- Grading card: single card with `card-header` + `card-collapse`

**5. Landing Page Product Card Compact (achieved via CSS overrides in `style.css`)**
- Smaller badges, tighter spacing
- Carousel: hidden description in thumbnails (when `.compact-thumb`), smaller gallery dimensions
- Two-column grid (`--shop-grid-cols: 2`) for compact layout
- Carousel aspect ratio fixed to square (1 / 1)

**6. Admin Inventory Table Compact Layout**
- Category selector hidden unless editing product category
- Price override with discount % badge, save/cancel inline buttons
- Delete product button + confirm dialog
- Draggable row reorder with `.inventory-drag-handle`
- Weight input `type="number"` step `0.01` for decimal support

**7. Variant chips wrapped into compact pill + dropdown (landing cards)**
- HTML: replaced `.product-weight-selector` with `.product-variant-selector` containing a `.variant-pill` (inline compact pill with chevron) and `.variant-chips-dropdown` (absolutely positioned dropdown with chips arranged vertically)
- CSS: pill styled as compact rounded chip with hover green accent; dropdown has subtle shadow, fade-in animation, and chips styled vertically with active green gradient state
- JS: pill toggle opens/closes dropdown (closes others); chip click handler syncs pill text and closes dropdown; click-outside listener dismisses open dropdowns

**8. Hero Section — Glassmorphism + 3D Animated Redesign**
- **Background**: Deep green gradient (`#0a1f14 → #2a5222 → #3d3518`) replaces old image-only background; three.js particle canvas moved into hero section as full-bleed backdrop with `pointer-events: none`
- **Glassmorphism Card** (`.hero-content`): Full-width card with mushroom image as CSS background (`url("/images/hero_mushroom.png") center 30% / cover`), overlaid with a dark-green gradient (`rgba(10,31,20,0.55)→rgba(42,82,34,0.20)`) for readability. Combined with `backdrop-filter: blur(18px) saturate(1.3)` to blur Three.js behind the card. The far-right "Farm to Doorstep" badge is positioned absolutely inside the card.
- **3D Entrance**: staggered `fadeInUp` animation per child element (0.08s–0.48s delays) with cubic-bezier easing
- **3D Hover Tilt**: `.hero-content` rotates 1.2deg on X/Y with `perspective: 1200px` on parent; buttons get `translateZ` lift + scale on hover
- **Ambient Gradient Overlay** (`::before`): radial gradient mesh animates with `heroAmbient` keyframes (scale + rotate over 16s)
- **Floating Blobs** (`.hero-blob-1/2/3`): three blurred radial-gradient circles (green, amber, light green) animate with independent `blobFloat` keyframes (22s/18s/20s) for organic motion
- **Shimmer Text** (`.hero-highlight`): animated gradient `background-clip: text` with 4s shimmer cycle
- **Glass Buttons**: `.btn-primary-hero` rounded-pill with green glow shadow, arrow translate on hover; `.btn-outline-hero` glass with `backdrop-filter`
- **Trust Badges**: frosted icon circles with `backdrop-filter: blur(4px)`, white text
- **Responsive**: `<768px` — reduced blur (14px), no hover tilt, blobs hidden for perf; `<480px` — further reduced blur (10px), tighter padding, stacked buttons

**9. Mushroom-Themed Hero Enhancements (Premium Spore Ecosystem)**
- **Three.js Spore Particles**: Replaced uniform green dots with three distinct particle clouds — (1) warm golden-amber bioluminescent spores in a flattened sphere, (2) soft forest-green background haze, (3) large bright golden-white spore clusters. All use `AdditiveBlending` for a glowing, ethereal look.
- **Mushroom Nucleus**: Dual-layer icosahedron — outer wireframe (`#d4a84b` gold, 0.35 opacity) + inner solid glow core (`#f5d742`, 0.15 opacity). Both breathe gently with `sin()` oscillation.
- **Organic Motion**: Rotation speeds halved for slower, more atmospheric drift; `sin()`-based Y-axis floating (0.06–0.12 frequency) gives a hovering spore feel; cluster particles pulse their opacity.
- **Mycelium Glow Ring** (`.mycelium-glow`): A centered 600px radial gradient circle with golden-green tones that pulses `scale(1↔1.08)` over 4s, mimicking bioluminescent mycelium in forest soil.
- **Spore Motes** (`.spore-mote` × 12): CSS-animated floating particles positioned along the bottom edge, each with unique drift speed (11s–22s), size (3–6px), and opacity. They rise vertically with a gentle X-offset and fade out near the top — mimicking airborne mushroom spores catching light.
- **Growth Emergence Entrance**: Elements no longer just fade-up — they `scale(0.85→1.03→0.98→1)` with a slight overshoot, like mushrooms sprouting from the forest floor.
- **Bioluminescent Border Pulse** (`.hero-content::after`): A subtle golden-green gradient border glow that fades `0→0.7→0` over 5s, giving the glass card a living, breathing edge.
- **Mobile perf**: All motes, glow ring, and border pulse are disabled below 768px for smooth scrolling. Only the Three.js canvas + glass card remain active.
