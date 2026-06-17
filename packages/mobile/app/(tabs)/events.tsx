import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as eventsApi from '@/services/events';

export default function EventsScreen() {
  const { data, isLoading } = useQuery({
    queryKey: ['events'], queryFn: eventsApi.getUpcomingEvents,
  });

  return (
    <View style={styles.container}>
      <FlatList
        data={data || []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => router.push(`/event/${item.id}`)}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.meta}>{new Date(item.start_time).toLocaleDateString()} · {item.event_type_name}</Text>
            <Text style={styles.capacity}>{item.registrations_count} / {item.capacity} registered</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={isLoading ? <Text style={styles.empty}>Loading...</Text> : <Text style={styles.empty}>No upcoming events</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 10, elevation: 1 },
  title: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 14, color: '#666', marginTop: 4 },
  capacity: { fontSize: 13, color: '#888', marginTop: 2 },
  empty: { textAlign: 'center', color: '#999', marginTop: 40 },
});
