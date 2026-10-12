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
`P0` `regression` · Spec 04 R6 · Status: Draft
1. Open a detail URL with a non-existent id (customer, service, booking). 2. Stop the API server and use a list screen and a save action; restart it. 3. Let the access token expire (or delete it) and click a navigation link.
**Expect:** not-found shows a clear message with a way back; with the API down the user sees an error state and unsaved form content is not lost; an expired session leads to login and returns to the page afterwards. No white screen, no raw stack trace, no endless spinner.

### UIX-09 · Navigation integrity
`P1` `regression` · Spec 04 R7 · As: owner, tenant, system · Status: Draft
1. Click every sidebar item and every dashboard tile for the persona. Use browser back and forward across five pages. Type an unknown URL.
**Expect:** every item leads to a working page (no dead link); the active item is highlighted for the current page, including nested routes such as `/customers/{id}`; back / forward restore the right page; an unknown URL lands on the dashboard.

### UIX-10 · No console errors or failed requests on a full tour
`P1` `regression` · Status: Draft
1. With the console and network panel recording, repeat SMK-02 to SMK-07.
**Expect:** no uncaught exceptions, no React key / state warnings that indicate broken behaviour, no 4xx / 5xx requests other than those a negative test intends. List every offender with its page.

### UIX-11 · Long and unusual content
`P2` `regression` · Spec 05 R1 · Status: Draft
1. Create a customer named with 120 characters, accents and an apostrophe (`E2E {RUN} María-José O'Neill …`), and a service with a 500-character description and a `<b>tag</b>` in its name.
**Expect:** text wraps or truncates with a tooltip, never breaks the layout; markup is shown as text, not rendered (no script or HTML injection) on lists, detail pages, the calendar, receipts and the widget.
