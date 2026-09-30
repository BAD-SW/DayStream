import { PageHeader } from './PageHeader';
import { Button } from '../actions/Button';

export default {
  title: 'Layout/PageHeader',
  component: PageHeader,
};

export const TitleOnly = { args: { title: 'Settings' } };
export const WithSubtitleAndActions = {
  args: {
    title: 'New theme',
    subtitle: 'Transcend Health · Navy base',
    actions: <><Button variant="ghost">Cancel</Button><Button>Save theme</Button></>,
  },
};
