# Requirements Document

## Introduction

This feature enhances the DayStream application with a fully styled dark/light mode switch. The current application defaults to a dark theme and has a basic toggle mechanism in place. This feature defines the warm ivory light theme palette, integrates the toggle button into the top menu bar, and persists the user's preference at the account level so it follows them across devices and sessions.

## Glossary

- **Theme_Switch**: The UI button in the top menu bar that toggles between dark and light mode
- **ThemeProvider**: The React context provider that manages theme state and applies CSS token overrides via the `data-theme` attribute
- **Light_Theme**: The warm ivory color scheme with golden accents, soft shadows, and frosted glass effects
- **Dark_Theme**: The existing dark color scheme with dark backgrounds and light text
- **User_Preference_Service**: The backend service responsible for storing and retrieving per-user settings including theme mode
- **Design_Token_System**: The CSS custom property (variable) system that drives all colors, shadows, and borders across the application
- **Dashboard_Tile**: A dark charcoal (#222222) card component used on the dashboard that retains its dark styling in both themes

## Requirements

### Requirement 1: Light Theme Color Tokens

**User Story:** As a user, I want the light mode to use a warm ivory palette with golden accents, so that the interface feels premium and cohesive with the DayStream brand.

#### Acceptance Criteria

1. WHEN the Light_Theme is active, THE Design_Token_System SHALL set the main background color to #F8F5EE
2. WHEN the Light_Theme is active, THE Design_Token_System SHALL set the surface color to #F3EEDF
3. WHEN the Light_Theme is active, THE Design_Token_System SHALL set the primary text color to #2C2C2C
4. WHEN the Light_Theme is active, THE Design_Token_System SHALL set the secondary text color to #666666
5. WHEN the Light_Theme is active, THE Design_Token_System SHALL set the primary brand color to #C89B3C
6. WHEN the Light_Theme is active, THE Design_Token_System SHALL set the light border color to #E5DDCD
7. WHEN the Light_Theme is active, THE Design_Token_System SHALL set the medium border color to #D8CEBA
8. WHEN the Light_Theme is active, THE Design_Token_System SHALL apply soft shadows using 0 4px 12px rgba(0,0,0,0.05) for small elevations
9. WHEN the Light_Theme is active, THE Design_Token_System SHALL apply medium shadows using 0 8px 20px rgba(0,0,0,0.08) for larger elevations

### Requirement 2: Background Gradient and Glass Effects

**User Story:** As a user, I want the light mode to feature subtle golden gradients and frosted glass effects, so that the interface has visual depth without high contrast.

#### Acceptance Criteria

1. WHEN the Light_Theme is active, THE Design_Token_System SHALL apply a background gradient combining a radial-gradient with golden tint and a linear-gradient from #FAF8F2 to #F5F1E8
2. WHEN the Light_Theme is active, THE Design_Token_System SHALL style the header with a glass effect using backdrop-filter blur(12px)
3. WHEN the Light_Theme is active, THE Design_Token_System SHALL style the sidebar with background color #F7F3EA and border color #E5DDCD
4. WHEN the Light_Theme is active, THE Design_Token_System SHALL style KPI cards with a frosted glass effect using backdrop-filter

### Requirement 3: Navigation Styling in Light Mode

**User Story:** As a user, I want navigation elements to use the gold accent color in light mode, so that active items are clearly distinguishable.

#### Acceptance Criteria

1. WHEN the Light_Theme is active, THE Design_Token_System SHALL set the active menu item background to #F1E7D0
2. WHEN the Light_Theme is active, THE Design_Token_System SHALL set the active menu item text color to #A77D22
3. WHEN the Light_Theme is active, THE Design_Token_System SHALL use #C89B3C as the accent color for branding and active navigation indicators

### Requirement 4: Dark Tile Preservation

**User Story:** As a user, I want dashboard tiles to remain dark in both themes, so that data visualization maintains contrast and readability.

#### Acceptance Criteria

1. THE Dashboard_Tile SHALL use background color #222222 regardless of the active theme
2. WHILE the Light_Theme is active, THE Dashboard_Tile SHALL display text in #FFFFFF on its dark background
3. WHILE the Dark_Theme is active, THE Dashboard_Tile SHALL display text in #FFFFFF on its dark background

### Requirement 5: Theme Toggle Button in Menu Bar

**User Story:** As a user, I want a clearly visible toggle button in the top menu bar, so that I can switch between dark and light modes with a single click.

#### Acceptance Criteria

1. THE Theme_Switch SHALL be rendered in the header section of the AppLayout component
2. WHEN the user clicks the Theme_Switch, THE ThemeProvider SHALL toggle the active theme between Dark_Theme and Light_Theme
3. THE Theme_Switch SHALL display a sun icon when the Dark_Theme is active, indicating the option to switch to light
4. THE Theme_Switch SHALL display a moon icon when the Light_Theme is active, indicating the option to switch to dark
5. THE Theme_Switch SHALL include an accessible label describing the action (e.g., "Switch to light mode" or "Switch to dark mode")
6. WHEN the theme changes, THE ThemeProvider SHALL apply the new theme within 100ms without a full page reload

### Requirement 6: User-Level Preference Persistence

**User Story:** As a user, I want my theme preference saved to my account, so that the setting follows me across devices and browser sessions.

#### Acceptance Criteria

1. WHEN the user toggles the theme, THE User_Preference_Service SHALL persist the selected mode (dark or light) associated with the authenticated user's account
2. WHEN an authenticated user loads the application, THE ThemeProvider SHALL retrieve the stored theme preference from the User_Preference_Service and apply it
3. IF the User_Preference_Service is unavailable, THEN THE ThemeProvider SHALL fall back to the locally stored preference in localStorage
4. IF no stored preference exists for the user, THEN THE ThemeProvider SHALL default to the operating system's color scheme preference
5. WHEN the user is not authenticated, THE ThemeProvider SHALL use the localStorage preference or operating system default

### Requirement 7: Theme Transition and Performance

**User Story:** As a user, I want theme transitions to be smooth and performant, so that switching modes does not cause visual jank or layout shifts.

#### Acceptance Criteria

1. WHEN the theme changes, THE ThemeProvider SHALL apply a CSS transition on color and background-color properties lasting between 150ms and 300ms
2. THE ThemeProvider SHALL apply the theme by updating the `data-theme` attribute on the document root element
3. WHEN the theme changes, THE Design_Token_System SHALL update all CSS custom properties without causing layout reflow on the main content area

### Requirement 8: Accessibility Compliance

**User Story:** As a user with visual impairments, I want the light theme to meet accessibility standards, so that content remains readable.

#### Acceptance Criteria

1. WHILE the Light_Theme is active, THE Design_Token_System SHALL ensure that primary text (#2C2C2C) on the main background (#F8F5EE) meets WCAG 2.1 AA contrast ratio (minimum 4.5:1)
2. WHILE the Light_Theme is active, THE Design_Token_System SHALL ensure that secondary text (#666666) on the main background (#F8F5EE) meets WCAG 2.1 AA contrast ratio (minimum 4.5:1)
3. THE Theme_Switch SHALL be operable via keyboard using Enter or Space keys
4. THE Theme_Switch SHALL have a minimum touch target size of 44x44 CSS pixels
5. WHEN the theme changes, THE ThemeProvider SHALL not disrupt screen reader focus or announce the change via an appropriate ARIA mechanism
