import type { Preview } from '@storybook/react';
import '../src/design-system/tokens/index.css';
import '../src/design-system/themes/dark.css';
import '../src/design-system/themes/light.css';

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#1A1A1A' },
        { name: 'light', value: '#FFFFFF' },
      ],
    },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
};

export default preview;
