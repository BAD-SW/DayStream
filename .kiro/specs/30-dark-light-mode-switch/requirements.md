# Requirements Document

## Introduction

This feature implements a user-level dark/light mode switch for the DayStream application. The toggle button is located in the top menu bar (header). The dark mode is the current default theme with charcoal backgrounds and gold accents. The light mode introduces a premium enterprise aesthetic with warm ivory backgrounds, champagne gold accents, and preserved dark dashboard tiles.

## Glossary

- **Theme_Toggle**: The button in the application header that switches between dark and light mode
- **Theme_Provider**: The React context provider that manages the current theme mode and applies it to the DOM
- **Light_Mode**: The light UI variant featuring warm ivory backgrounds, champagne gold accents, and charcoal text
- **Dark_Mode**: The current default UI variant with charcoal/dark backgrounds and gold accents
- **Theme_Preference**: The user's selected theme mode, persisted in localStorage and optionally in the user profile via API
- **CSS_Custom_Properties**: CSS variables defined at the root level that control color, shadow, and border values across the application
- **Dashboard_Tile**: The dark metric cards (#222222) displayed on the dashboard that remain unchanged across both modes
- **KPI_Card**: Key Performance Indicator card components displaying metrics with glass-morphism styling in light mode
- **Glass_Effect**: A visual effect combining semi-transparent backgrounds with backdrop-filter blur to create frosted glass appearance

## Requirements

### Requirement 1: Theme Toggle Placement

**User Story:** As a user, I want to see a theme toggle button in the top menu bar, so that I can switch between dark and light mode from any page.

#### Acceptance Criteria

1. THE Theme_Toggle SHALL be rendered in the header bar, positioned within the right-side control group alongside the user name and sign-out button
2. WHEN the user is authenticated, THE Theme_Toggle SHALL be visible on all pages that use the AppLayout
3. THE Theme_Toggle SHALL display a sun icon when the current mode is dark and a moon icon when the current mode is light

### Requirement 2: Theme Switching Behavior

**User Story:** As a user, I want to click the toggle to instantly switch between dark and light mode, so that I can choose my preferred visual environment.

#### Acceptance Criteria

1. WHEN the user clicks the Theme_Toggle while in Dark_Mode, THE Theme_Provider SHALL switch the application to Light_Mode
2. WHEN the user clicks the Theme_Toggle while in Light_Mode, THE Theme_Provider SHALL switch the application to Dark_Mode
3. WHEN the theme mode changes, THE Theme_Provider SHALL apply the corresponding CSS_Custom_Properties within a single animation frame
4. WHEN the theme mode changes, THE Theme_Provider SHALL update the `data-theme` attribute on the document root element to the selected mode value

### Requirement 3: Theme Preference Persistence

**User Story:** As a user, I want my theme preference to be remembered, so that the application loads in my preferred mode on return visits.

#### Acceptance Criteria

1. WHEN the user changes the theme mode, THE Theme_Provider SHALL persist the selected mode to localStorage under the key `theme-mode`
2. WHEN the application initializes, THE Theme_Provider SHALL read the stored preference from localStorage and apply it as the initial mode
3. IF no stored preference exists in localStorage, THEN THE Theme_Provider SHALL use the operating system's preferred color scheme as the default mode
4. WHERE the user profile API endpoint is available, THE Theme_Provider SHALL save the theme preference to the user profile on change

### Requirement 4: Light Mode Color Palette

**User Story:** As a user, I want the light mode to have a premium enterprise appearance with warm ivory backgrounds and champagne gold accents, so that the interface feels professional and sophisticated.

#### Acceptance Criteria

1. WHILE Light_Mode is active, THE CSS_Custom_Properties SHALL set the main background to warm ivory (#F8F5EE) with a subtle golden radial gradient
2. WHILE Light_Mode is active, THE CSS_Custom_Properties SHALL set sidebar background to #F7F3EA with a light border of #E5DDCD
3. WHILE Light_Mode is active, THE CSS_Custom_Properties SHALL set the header/topbar background to rgba(255,255,255,0.6) with a backdrop-filter blur Glass_Effect
4. WHILE Light_Mode is active, THE CSS_Custom_Properties SHALL set primary text color to charcoal #2C2C2C and secondary text color to #666666
5. WHILE Light_Mode is active, THE CSS_Custom_Properties SHALL set the brand accent color to gold #C89B3C with hover state #B88A2E
6. WHILE Light_Mode is active, THE CSS_Custom_Properties SHALL set borders to #E5DDCD for light and #D8CEBA for medium weight
7. WHILE Light_Mode is active, THE CSS_Custom_Properties SHALL set box shadows to 0 4px 12px rgba(0,0,0,0.05)

### Requirement 5: Light Mode Active Menu Styling

**User Story:** As a user, I want active navigation items to be clearly highlighted in light mode, so that I can see which page I'm on.

#### Acceptance Criteria

1. WHILE Light_Mode is active, THE CSS_Custom_Properties SHALL set the active menu item background to #F1E7D0
2. WHILE Light_Mode is active, THE CSS_Custom_Properties SHALL set the active menu item text color to #A77D22

### Requirement 6: Dark Tiles Preservation

**User Story:** As a user, I want the dashboard metric tiles to remain dark in both modes, so that data visualization maintains contrast and readability.

#### Acceptance Criteria

1. WHILE Light_Mode is active, THE Dashboard_Tile components SHALL retain their #222222 background color
2. WHILE Dark_Mode is active, THE Dashboard_Tile components SHALL retain their #222222 background color
3. THE Dashboard_Tile background color SHALL NOT be overridden by the theme CSS_Custom_Properties

### Requirement 7: KPI Card Glass Styling in Light Mode

**User Story:** As a user, I want KPI cards to have a frosted glass appearance in light mode, so that they stand out from the warm background while maintaining visual elegance.

#### Acceptance Criteria

1. WHILE Light_Mode is active, THE KPI_Card components SHALL have a background of rgba(255,255,255,0.7) with backdrop-filter blur
2. WHILE Light_Mode is active, THE KPI_Card components SHALL have a light border for subtle definition
3. WHILE Dark_Mode is active, THE KPI_Card components SHALL use the existing dark surface styling

### Requirement 8: Visual Constraints

**User Story:** As a designer, I want specific visual elements to be avoided in light mode, so that the premium warm aesthetic is maintained.

#### Acceptance Criteria

1. WHILE Light_Mode is active, THE CSS_Custom_Properties SHALL NOT use pure white (#FFFFFF) as a background color for any layout surface
2. WHILE Light_Mode is active, THE CSS_Custom_Properties SHALL NOT use bright gold or yellow tones as background fills
3. WHILE Light_Mode is active, THE CSS_Custom_Properties SHALL NOT use blue gradient backgrounds

### Requirement 9: Accessibility

**User Story:** As a user with accessibility needs, I want the theme toggle to be keyboard-accessible and properly labeled, so that I can operate it with assistive technology.

#### Acceptance Criteria

1. THE Theme_Toggle SHALL be focusable via keyboard Tab navigation
2. THE Theme_Toggle SHALL have an `aria-label` attribute that indicates the action (switch to light mode or switch to dark mode)
3. WHEN the Theme_Toggle receives a keyboard Enter or Space key press, THE Theme_Toggle SHALL trigger the theme change
4. WHILE Light_Mode is active, THE CSS_Custom_Properties SHALL maintain a minimum contrast ratio of 4.5:1 between primary text (#2C2C2C) and background (#F8F5EE) colors

### Requirement 10: Transition and Animation

**User Story:** As a user, I want the theme switch to feel smooth, so that mode changes are not jarring.

#### Acceptance Criteria

1. WHEN the theme mode changes, THE Theme_Provider SHALL apply a CSS transition on background-color and color properties with a duration between 150ms and 300ms
2. THE Theme_Toggle icon SHALL transition between sun and moon states without layout shift
