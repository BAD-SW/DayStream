# Suite 16 — UI Cross-Cutting

Covers spec 04 (design system: layout, forms, tables, feedback, accessibility, responsive) and spec 30 (dark / light mode), plus behaviours every screen must share. Run on a sample of screens, one per layout type: `/customers` (list), a customer detail (tabs), `/customers/new` (form), `/bookings/calendar`, `/dashboard`, `/admin/tenants` (admin layout with the tabbed modal), `/checkout`. Conventions: [README](../README.md).

Staff pages are excluded from visual-consistency checks until they are migrated to the design system (KI-8).

---

### UIX-01 · Dark and light mode across layouts
`P1` `regression` · Spec 30 R1–R6 · As: owner, system · Status: Draft
1. On each sample screen switch dark ↔ light.
**Expect:** every element changes (no white panel left in dark mode, no dark text on dark background); tiles that are meant to stay dark in light mode do so; the toggle is in the same place on the business and admin layouts; the choice persists across reload and across logout / login on the same browser.

### UIX-02 · Contrast and readability in both modes
`P1` `regression` · Specs 04 R9, 30 R9 · Status: Draft
1. In each mode, check body text, muted text, buttons, badges, the active sidebar item and form placeholders on three screens.
**Expect:** text contrast is at least 4.5:1 (3:1 for large text and interface components). List any pair that fails with its measured ratio.

### UIX-03 · Keyboard only
`P1` `regression` · Spec 04 R9 · Status: Draft
1. Without the mouse: log in, open Customers, open a customer, open and close a modal, submit a form, use a dropdown and a date picker.
**Expect:** everything is reachable in a logical order; focus is always visible; a modal traps focus and returns it on close; Escape closes modals and drawers.

### UIX-04 · Responsive layouts
`P1` `regression` · Spec 04 R10 · Status: Draft
1. View the sample screens at widths 1440, 1024, 768 and 390.
**Expect:** no horizontal page scroll; the sidebar collapses to a menu; tables switch to cards on mobile; the wide tenant / business modal stays usable; the calendar remains readable or offers a reduced view.

### UIX-05 · Form behaviour is consistent
`P1` `regression` · Spec 04 R4 · Status: Draft
1. On three different create forms: submit empty; fix one field; submit valid; press save twice quickly.
**Expect:** labels above inputs; required fields marked; errors appear next to the field and clear when fixed; the save button prevents a double submit (one record created); success is confirmed with a visible message.

### UIX-06 · Money is always currency
`P0` `regression` · AGENTS rule 7 · Status: Draft
1. Enter 1234.56, 0.1, 1,5 (comma decimal) and 99.999 in three currency inputs (service price, record payment, billing plan). Scan the screens visited in this run for money values.
**Expect:** values are stored and redisplayed exactly (no 0.30000000000000004, no 100× errors); a third decimal is refused or rounded visibly; every amount is shown with the business's currency and two decimals.
**Cross-check:** the API holds integer cents for each value entered.

### UIX-07 · Tables: sort, page, empty and loading states
`P2` `regression` · Spec 04 R5 · Status: Draft
1. On three list screens: sort by two columns, change page, apply a filter that returns nothing, reload while watching the loading state.
**Expect:** the sort indicator matches the order; paging keeps the filter and sort; an empty result shows an explanatory empty state, not a blank area; a loading indicator shows while data loads.

### UIX-08 · Errors are handled, not swallowed
`P0` `regression` · Spec 04 R6 · Status: Verified
1. Open a detail URL with a non-existent id (customer, service, booking). 2. Stop the API server and use a list screen and a save action; restart it. 3. Let the access token expire (or delete it) and click a navigation link.
**Expect:** not-found shows a clear message with a way back; with the API down the user sees an error state and unsaved form content is not lost; an expired session leads to login and returns to the page afterwards. No white screen, no raw stack trace, no endless spinner.

### UIX-09 · Navigation integrity
`P1` `regression` · Spec 04 R7 · As: owner, tenant, system · Status: Verified
1. Click every sidebar item and every dashboard tile for the persona. Use browser back and forward across five pages. Type an unknown URL.
**Expect:** every item leads to a working page (no dead link); the active item is highlighted for the current page, including nested routes such as `/customers/{id}`; back / forward restore the right page; an unknown URL lands on the dashboard.

### UIX-10 · No console errors or failed requests on a full tour
`P1` `regression` · Status: Verified
1. With the console and network panel recording, repeat SMK-02 to SMK-07.
**Expect:** no uncaught exceptions, no React key / state warnings that indicate broken behaviour, no 4xx / 5xx requests other than those a negative test intends. List every offender with its page.

### UIX-11 · Long and unusual content
`P2` `regression` · Spec 05 R1 · Status: Draft
1. Create a customer named with 120 characters, accents and an apostrophe (`E2E {RUN} María-José O'Neill …`), and a service with a 500-character description and a `<b>tag</b>` in its name.
**Expect:** text wraps or truncates with a tooltip, never breaks the layout; markup is shown as text, not rendered (no script or HTML injection) on lists, detail pages, the calendar, receipts and the widget.

### UIX-12 · Settings: one Save, changed fields marked, leaving asks first
`P1` `regression` · David 2026-10-28 · As: owner · Status: Verified
1. Settings: read the tabs. 2. Payment Methods: switch Card off. 3. Switch it on again. 4. System: tick "Customers can cancel" under Appointments and change its hours; scroll down. 5. Leads tab: add a stage, rename one, move one, delete one that has leads, then Undo the delete. 6. Integrations: change Mode. 7. Click Dashboard in the menu; choose Stay. 8. Click Save changes; reload.
**Expect:** step 1: System, Customer Lifecycle, Leads, Notifications, Payment Methods, Integrations, Booking Widget, a separator, then Processes and Appearance (these two keep their own buttons and are not part of Save changes). Step 2: the Card switch gets an orange ring, its section an orange outline with "Unsaved changes", the tab a dot, and the title row "You have unsaved changes." next to Save changes (enabled only while something is unsaved). Step 3: all marks go away. Step 4: only the changed checkbox and field are marked; the title, Save changes and the tabs stay in view while scrolling. Step 5: nothing is saved yet; the new stage shows "New", the renamed name is marked, a moved stage shows "Moved", the deleted one is crossed out with "Deleted when you save" and the stage its leads move to; Undo brings it back. Step 6: the Mode field is marked; Integrations has no Save button of its own (Test connection stays). Step 7 asks "Leave without saving?" with Leave / Stay. Step 8 says "All changes saved.", the marks go away and the reload shows the saved values. Closing or reloading the browser tab with unsaved changes gets the browser's own warning.

### UIX-13 · Events: one Save, changes marked, leaving asks first
`P1` `regression` · David 2026-11-01 · As: owner · Status: Verified
1. Open an event. On Details change Hosted at. 2. On Tickets add a ticket, rename or reprice one, delete one. 3. On Facilitators add one. 4. Follow a menu link; choose Stay. 5. Save changes. 6. Events → Types: add a type, rename one, delete one; Save changes. 7. Create Event: type a title, then follow a menu link.
**Expect:** as in Settings (UIX-12): the changed field is marked, its section outlined, its tab has a dot, the title row says "You have unsaved changes." next to Save changes; new rows show "New", deleted ones stay crossed out ("Deleted when you save" / "Removed when you save") with Undo; nothing is stored until Save changes, which says "All changes saved."; step 4 asks "Leave without saving?" (Leave / Stay); the title row and tabs stay in view. Publish, Cancel, Delete event, registrations, the waiting list, messages and recurring templates still act at once. Step 7 asks before leaving too.

### UIX-14 · Customer profile: one Save, changes marked, leaving asks first
`P1` `regression` · David 2026-11-01 · As: owner · Status: Verified
1. Open a person. In Overview change the city and the staff member. 2. Add a task, tick another done, add a note, mark a document for deletion, upload a new photo, switch Email Marketing on. 3. Open Notes, then Overview again. 4. Leave with "← Back to People", with the browser's Back button and with a menu link; choose Stay each time. 5. Save changes (in the header). 6. Reload.
**Expect:** the changed fields are marked, the Contact Information card is outlined with "Unsaved changes", the Overview tab has a dot and the header says "You have unsaved changes." next to Save changes (enabled only then); the header and tabs stay in view while scrolling; nothing in step 2 is stored yet: new task, note and photo show "New", the document is crossed out ("Deleted when you save", Undo), the ticked box is marked, and switching marketing on asks how the person gave consent (needed to save); each tab with changes has a dot; step 3 keeps the edits; every way out in step 4 asks "Leave without saving?" (Leave / Stay); step 5 stores everything (the task reminder email goes now) and says "All changes saved."; step 6 shows the saved values. More › Assign staff member opens the Staff member field. Still at once: payment methods, payments and orders, password reset, sending personal data, archive and anonymise. (David, 2026-11-01: one Save on a page applies to everything on it.)

### UIX-15 · Tables: filter icon beside the sort icon, all values, Apply; no pages
`P1` `regression` · David 2026-11-02 (design approved on the Table Filters mock-up) · As: owner · Status: Verified (People, Leads, Bookings, Reports, Services, Accounting, Staff, Leave, Resources, Locations, billing activity, audit trail, prospects, clock admin, customer billing tab, query editor); Draft (Orders, Payments, Memberships, Audit log, Gift cards, Admin users, My events, legacy report view)
1. On People open the filter icon of Name: search, Unselect all, tick one person, Apply. 2. Open Stage, then Added (a date column). 3. Scroll a long list. 4. Repeat on Leads, Bookings, Orders, Payments, Memberships, Audit log and a report. 5. Repeat on Offerings (Services, Products), Accounting (Bills, Expenses, Chart of Accounts), Staff, Leave, Resources, Locations, Gift cards, the customer profile Billing tab (Transaction history), Clock admin, and as platform user on Billing Activity, a tenant's Audit Trail / Charge History / Prospects and the Query Editor results.
**Expect:** every column header shows the sort icon and, beside it, a filter icon (no filter boxes above or below the headers). A text column lists all its values for the whole list (not only rows on screen) with counts, a search box, Select all / Unselect all and "Contains"; a date column opens quick ranges (Today, Yesterday, Last 7 / 30 days, This / Last month, Custom) beside two months with typed From / To. Nothing changes until Apply; Cancel leaves the list as it was; Clear is a button beside Cancel and Apply (David, 2026-11-04). A date range that is one of the quick ranges reopens showing it (e.g. "This month"), not "Custom range". A filtered column shows a filled icon with the number of values chosen. There are no pages: rows load as the list scrolls (Show more as a fallback) and the header row stays pinned; a table wider than the screen scrolls inside its own area with its header pinned there. Export CSV and bulk actions on People follow the same filters. No list starts filtered (David, 2026-11-04): Bookings, Orders, Bills, Expenses, the Journal, Leave, Billing Activity and the profile Transaction history show everything; date lists start newest first (Bookings for staff, Bills by due date, Expenses, the Journal, Transaction history). Sorting a column keeps the earlier order among rows with the same value (sort Name, then a column where all rows are equal: the rows do not move); a timestamp shown as a date sorts by that date. A date column's filter reloads from the server where the old From/To did. Search boxes stay where they were. Prospects Export CSV follows the column filters. Money columns (Orders total, Payments amount, profile transactions, bills, expenses, services, products, plans, gift cards, charge histories, billing activity, payroll) open the amount filter instead (David, 2026-11-02, decision 7 option C): a bar chart of how the amounts spread, two handles to drag and From / To boxes in the currency; the line under it says the range and how many rows match ("€40.00 – €100.00 · 2 of 4"); refunds count below zero on Payments. Accounting → Payroll entries are on the shared table too: a row opens its breakdown under it, and Totals add up the rows shown ("Totals (2 of 3 shown)"). The Query Editor results scroll inside their panel with the header pinned; NULL and cut-off values (click to expand) still show.

### UIX-16 · Offerings, Business Setup and Website: one Save, changes marked, leaving asks first
`P1` `regression` · David 2026-11-02 (decision 6: all modules) · As: owner · Status: Verified
1. Offerings → open a service: change the duration; add a variant (window: Add Variant), edit another, delete one; add an availability rule; upload an image. 2. Click "← Back to Offerings"; choose Stay. 3. Save changes (in the header). 4. Repeat on a product (price, SKU, image, variants), a membership plan (price, trial days, an included item), a promotion (value, a day, Applies to → Configure → Done) and a package (price, an included item). 5. Business Setup → open a staff member: change Languages; add a qualification, a weekly pattern (and Copy it), a day-off override and an hourly pay rule; pause the rule; switch tabs; Save changes. 6. Open a resource: change Capacity; add operating hours; Save changes. 7. Open a location: change Phone; open Monday; add a holiday (closed); assign a staff member; Save changes; then change the holiday's date and remove the staff member; Save changes. 8. Business Setup → Categories: add a product category and a note category; Taxes: add a tax rate, then edit its rate; follow a menu link and choose Stay; Save changes. 9. Website → open a page: change the title; Save changes. 10. Delete what you added (crossed out with Undo until Save changes); Save changes.
**Expect:** as in Settings (UIX-12): each changed field is marked, its card outlined with "Unsaved changes", the tab (staff, resource, Business Setup) has a dot and the header says "You have unsaved changes." next to Save changes (enabled only then); the header stays in view. Windows and inline forms say "Saved with the page's Save changes." and their button is "Add …" or "Done"; new rows show "New", edited rows "Changed", deleted rows stay crossed out with "Deleted when you save" (staff at a location: "Removed when you save") and Undo; a new image shows "New" and a removed product image "Image removed when you save". Nothing is stored before Save changes, which stores everything and says "All changes saved."; every way out asks "Leave without saving?" (Leave / Stay). A failed save says "Not saved: <section> (<reason>)" in red and keeps those changes unsaved; the message goes once nothing is unsaved. The location details are always editable (no separate Edit button). The holiday year cannot be switched while holiday hours are unsaved. Still at once: Activate, Pause, Archive, Restore, Deactivate, Set Primary, Publish. Not changed: Templates and Data Migration (decision 9 open); Accounting and Marketing → Leads (decisions 8 and 10 open). Resource maintenance windows: Weekly (a day) or Daily, both saved and shown (D-81 fixed).
11. Business Setup → Templates: open a template, change its subject, follow a menu link. 12. Marketing → Leads: see MKT-11. 13. Accounting: Add Vendor (type a name), switch to Expenses, Add Expense (amount, description); Save changes in the header. Then Bills → Add Bill with only a description → Create; Chart of Accounts → Add Account → Create (its own button); follow a menu link and choose Stay; Save changes; complete the bill (vendor, amount) and Create. 14. Accounting → Payroll → Tax Profiles → Edit: change Allowances, Save (own button); Edit again, change it back, Save changes in the header.
**Expect (11–14):** step 11: the tab row has a separator before Templates and Data Migration, which keep their own buttons; leaving with the changed open template asks "Leave without saving?". Step 13 (David, 2026-11-02, decision 8): each open form is outlined, its changed fields marked and its tab has a dot; Save changes stores the vendor and the expense together and closes both forms ("All changes saved."); the bill's own Create says "Vendor, Amount and Due Date are required" beside it; the account saved by its own Create is stored and is no longer unsaved while the bill still is (Bills keeps its dot); Save changes with the incomplete bill says "Not saved: Bill (Vendor, Amount and Due Date are required)"; once the bill is created by its own button nothing is unsaved and Save changes is disabled. Step 14: both ways store the tax profile. Archive, Delete, Void, Run Payroll and Finalize act at once.

### UIX-17 · Settings → Customer Lifecycle saves
`P1` `regression` · THE-22 test (David 2026-11-04) · As: owner · Status: Verified
1. Settings → Customer Lifecycle: change "Days before At Risk → Churned" (e.g. 60 → 90); Save changes. 2. Reload. 3. Put it back.
**Expect:** "All changes saved." and the value stays after the reload (before: "Not saved: Customer Lifecycle (Failed to save lifecycle config)", whatever the value, because two of its settings had no definition; migration 162).
