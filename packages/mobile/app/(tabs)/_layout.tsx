import { Tabs } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';

export default function TabLayout() {
  const theme = useTheme();

  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: theme.colors.primary,
      tabBarInactiveTintColor: '#999',
      headerStyle: { backgroundColor: theme.colors.primary },
      headerTintColor: '#fff',
    }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarLabel: 'Home' }} />
      <Tabs.Screen name="services" options={{ title: 'Book', tabBarLabel: 'Book' }} />
      <Tabs.Screen name="bookings" options={{ title: 'My Bookings', tabBarLabel: 'Bookings' }} />
      <Tabs.Screen name="events" options={{ title: 'Events', tabBarLabel: 'Events' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarLabel: 'Profile' }} />
    </Tabs>
  );
}
