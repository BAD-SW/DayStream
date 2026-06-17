import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@/theme/ThemeProvider';
import * as servicesApi from '@/services/services';

export default function ServicesScreen() {
  const theme = useTheme();
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['services', search],
    queryFn: () => servicesApi.getServices({ search: search || undefined }),
  });

  return (
    <View style={styles.container}>
      <TextInput style={styles.search} placeholder="Search services..." value={search} onChangeText={setSearch} />
      <FlatList
        data={data?.services || []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => router.push(`/service/${item.id}`)}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.meta}>{item.default_duration} min · ${(item.price / 100).toFixed(2)}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={isLoading ? <Text style={styles.empty}>Loading...</Text> : <Text style={styles.empty}>No services found</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  search: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 16 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 10, elevation: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 14, color: '#666', marginTop: 4 },
  empty: { textAlign: 'center', color: '#999', marginTop: 40 },
});
