// Shared prose keeps saved playback and future provider captures consistent.
export const keyboardReview = `I reviewed the Garden storefront's keyboard flow from product search through the cart and checkout. The basic links and form fields are usable, but three focus transitions can leave someone unsure where they are: opening the filter drawer, removing a cart item, and submitting an invalid address.

This review covers the desktop layout and the narrow layout where filters become a modal drawer. I traced focus order and event handling; I have not done a screen-reader pass on a physical device. The findings below describe the current behavior and the changes I would make.

## 1. Filter drawer: focus stays behind the overlay

**Priority: high.** In the narrow layout, activate Filters from the product list. The drawer appears, but focus stays on the trigger underneath it. The next Tab reaches a product card behind the backdrop. A keyboard user can keep moving through controls they cannot see without ever reaching the filters.

On opening, move focus to the drawer's Close filters button. Keep Tab and Shift+Tab within the open modal, make the background inert, and let Escape close it. Restore focus to the Filters trigger when the drawer closes. If navigation has removed that trigger, use the product-list heading as the fallback.

The desktop filter panel needs different behavior. It is part of the page, so its controls should stay in the ordinary tab order, with no focus trap. Crossing the responsive breakpoint while the drawer is open should also release the modal state; otherwise the page can remain inert after the overlay disappears.

**Acceptance check:** open Filters, cycle forward and backward through all controls, close with Escape, and confirm the next Tab reaches Sort. Repeat after changing the viewport while the drawer is open.

## 2. Cart removal: the focused button disappears

**Priority: high.** Each cart row has a Remove button. After removing the focused row, the browser falls back to the document body. The next Tab starts at the header, so removing three items requires repeatedly traversing the whole page.

After the row is removed from the DOM, focus the next row's Remove button. If there is no next row, use the previous row. When the cart becomes empty, focus Continue shopping. Use stable product IDs to find the target so a quantity update cannot accidentally send focus to a different product.

A small status message should announce the result, for example “Terracotta pot removed. 2 items in cart.” It should not take focus. If removal fails, leave the row in place, keep its button focused, and show an error beside that item. Moving focus optimistically would make a failed operation harder to recover from.

**Acceptance check:** remove the first, middle, and last rows, then the only remaining row. Also simulate a failed request and a slow response while tabbing away. A late response must not pull focus back from the field the customer is now editing.

## 3. Checkout errors: the summary is easy to miss

**Priority: high.** Submitting an incomplete shipping address displays a summary above the form, while focus stays on Continue. Because the summary is outside the current viewport, the page appears to have ignored the submission.

After a failed submit, focus the error-summary heading and scroll it into view. Give the heading a programmatic focus target without adding it to the normal tab sequence. Each summary entry should link to the corresponding input. Keep the entered address intact and associate the field's error text with that field.

Do this on submit, not on every validation update. If a postal-code error clears while someone types, update the message without moving focus. For a server-side failure unrelated to a field, keep the address available and provide a clear Retry button rather than pointing to an arbitrary input.

## 4. Product cards: too many stops before the next item

A card currently exposes the product image and title as separate links to the same URL. With twelve results, that adds twelve redundant Tab stops before accounting for quick-add buttons.

Wrap the image and title in one product link, then keep Quick add as a separate button outside it. Give that button a product-specific accessible name, such as “Add terracotta pot to cart.” Avoid making the whole card clickable with a nested button, since that creates ambiguous activation behavior.

The favorite toggle should remain independently focusable and expose its selected state. Enter on the product link should navigate; Enter or Space on either button should perform only that button's action. Adding a product should leave focus on Quick add and announce the updated cart count without opening the cart drawer unexpectedly.

## 5. Search suggestions: arrow keys and Escape disagree

The search field opens suggestions as you type. ArrowDown highlights the first result, but Tab currently accepts that result and navigates. This makes it difficult to leave search without choosing something.

Keep DOM focus in the input while arrow keys change the active suggestion. Enter accepts the active suggestion; when none is active, it submits the typed search. Tab should close the suggestions and continue to the next control without selecting a product. Escape should dismiss the list while preserving the query.

Also reset the active suggestion when fresh results arrive. The old active index might refer to a different product after an asynchronous response. An empty result set should remove the active reference entirely, and a stale response must not reopen a list the customer has already dismissed.

## 6. Visible focus and the sticky checkout footer

The quantity stepper has a focus ring, but the row's overflow clipping cuts off its bottom edge. The sticky checkout footer can also cover the focused delivery option when the viewport is short or zoomed.

Give the stepper enough internal space for its indicator, or use an inset indicator that remains visible. Add scroll clearance for the footer to the form's focus targets. Check both the light and dark themes, since the current low-contrast border is difficult to distinguish from hover styling in the dark cart.

These checks need actual visual inspection: a control can be the active element while its focus indicator is clipped or the control itself is hidden behind another surface.

## Suggested order of work

1. Fix the filter drawer and cart-removal focus behavior. Both can interrupt an otherwise ordinary shopping session.
2. Make failed checkout submission move to a useful error summary.
3. Simplify card tab stops and make search selection predictable.
4. Check focus visibility at narrow widths, with zoom, and with the sticky footer present.

I would keep these in small changes with focused interaction tests. The first pass should establish where focus lands after each action; the visual pass should confirm that target is actually visible. No source changes have been made during this review.`;

export const keyboardWalkthrough = `Here's a concrete walkthrough using a customer who searches for a pot, filters the results, and corrects a shipping address without touching a mouse.

## Search and choose a product

Start in Search products and type “terracotta.” When suggestions appear, press ArrowDown twice. The second suggestion becomes active, but the caret's input remains the focused element. Press Escape: the suggestions close and “terracotta” stays in the field.

Now press Tab. Focus should move to the next page control without navigating. Return to Search with Shift+Tab, reopen the suggestions with ArrowDown, and press Enter on a product. Once the product page has rendered, move focus to its main heading so the customer has a clear starting point in the new page.

The distinction to test is dismissal versus selection. Escape and Tab dismiss the popup; Enter selects the active result. None of those handlers should interfere with text composition in the input.

## Open filters and return to the results

On a narrow viewport, activate Filters. Focus moves to Close filters, then Tab reaches the category checkboxes, price fields, and Apply filters in their visual order. Shift+Tab from Close filters should wrap to the last enabled control while the modal is open.

Suppose the customer selects Outdoor and activates Apply filters. Close the drawer, restore focus to Filters, and announce “8 products found.” Do not jump to the first product automatically. The customer can then Tab through Sort and into the results using the same order they already learned.

If applying filters fails, keep the drawer open with the selections intact. Put the error near Apply filters and leave focus there so the customer can retry or dismiss the drawer. A loading state should prevent duplicate submissions without removing the focused control.

## Remove an item without starting over

Imagine the cart contains a terracotta pot, a watering can, and seed trays. Focus Remove watering can and activate it. After the successful response removes that row, focus should move to Remove seed trays, the control that followed it.

If seed trays are removed next, use Remove terracotta pot. Removing that last product moves focus to Continue shopping. This gives every successful removal a predictable destination, including the empty state.

There is one important timing detail: only restore focus if it was still in the removed row when the response arrived. If the customer has already tabbed to the discount-code field, preserve that newer choice. A saved row ID and a check of the active element just before removal are more reliable than an unconditional focus call after every cart update.

## Recover from an invalid address

Leave Postal code empty and activate Continue. Focus moves to the summary heading, which reads “There is a problem with your address.” Tab reaches the “Enter a postal code” link; activating that link focuses Postal code directly.

After entering a valid code, Tab should continue to the next field in the form. It should not return to the summary just because validation ran again. Submitting successfully can then advance to the delivery step and focus its heading.

For a delivery-service outage, show a different recovery path: preserve the completed address, explain that delivery options could not be loaded, and offer Retry. There is no field for the customer to correct in that case.

## What I would automate

| Interaction | Assertion |
| --- | --- |
| Open and close the filter drawer | Focus enters the modal and returns to its trigger |
| Tab from a search suggestion | No product is selected; focus continues forward |
| Remove a middle cart row | Focus reaches the next row's removal button |
| Remove the last cart item | Continue shopping receives focus |
| Finish removal after focus moved elsewhere | The customer's new focus target is preserved |
| Submit an invalid address | The summary receives focus and its link targets the invalid field |

Run the same drawer checks backwards with Shift+Tab and at the responsive breakpoint. Then do a manual pass for clipped indicators, zoom, scrolling, and announcement timing. The automated assertions can prove which element has focus, but they cannot establish that the whole experience is clear to a person using it.`;
