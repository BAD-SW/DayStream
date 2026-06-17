import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet } from 'react-native';
import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { useTheme } from '@/theme/ThemeProvider';
import * as bookingsApi from '@/services/bookings';
import * as membershipApi from '@/services/membership';

export default function DashboardScreen() {
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);
  const [refreshing, setRefreshing] = useState(false);

  const { data: nextBooking, refetch: refetchBooking } = useQuery({
    queryKey: ['nextBooking'], queryFn: bookingsApi.getNextBooking,
  });
  const { data: membership, refetch: refetchMembership } = useQuery({
    queryKey: ['membership'], queryFn: membershipApi.getActiveMembership,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchBooking(), refetchMembership()]);
    setRefreshing(false);
  }, []);

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text style={[styles.greeting, { color: theme.colors.text }]}>
        Hi, {user?.firstName || 'there'} 👋
      </Text>

      {/* Membership Card */}
      {membership && (
        <View style={[styles.card, { borderLeftColor: theme.colors.primary }]}>
          <Text style={styles.cardTitle}>{membership.planName}</Text>
          <Text style={styles.cardSub}>{membership.creditsRemaining} credits remaining</Text>
        </View>
      )}

      {/* Next Booking */}
      {nextBooking && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Next Booking</Text>
          <Text style={styles.cardSub}>{nextBooking.serviceName}</Text>
          <Text style={styles.cardSub}>{new Date(nextBooking.startTime).toLocaleString()}</Text>
        </View>
      )}

      {/* Quick Actions */}
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.primary }]}
          onPress={() => router.push('/(tabs)/services')}>
          <Text style={styles.actionText}>Book</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.secondary }]}
          onPress={() => router.push('/checkin')}>
          <Text style={styles.actionText}>Check In</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.accent }]}
          onPress={() => router.push('/(tabs)/events')}>
          <Text style={styles.actionText}>Events</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  greeting: { fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: '#ddd', elevation: 2 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardSub: { fontSize: 14, color: '#666', marginTop: 4 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  actionBtn: { flex: 1, borderRadius: 10, padding: 16, alignItems: 'center' },
  actionText: { color: '#fff', fontWeight: '600' },
});
