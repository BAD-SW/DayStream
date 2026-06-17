import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'react-native-qrcode-svg';
import { useTheme } from '@/theme/ThemeProvider';
import * as checkinApi from '@/services/checkin';

export default function CheckInScreen() {
  const theme = useTheme();
  const { data: qrData } = useQuery({
    queryKey: ['myQrCode'], queryFn: checkinApi.getMyQrCode,
  });
  const { data: nextBooking } = useQuery({
    queryKey: ['nextBookingCheckin'], queryFn: checkinApi.getNextBookingForCheckin,
  });

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.title, { color: theme.colors.text }]}>Check In</Text>

      {qrData?.code ? (
        <View style={styles.qrContainer}>
          <QRCode value={qrData.code} size={250} />
          <Text style={styles.qrHint}>Show this to the receptionist</Text>
        </View>
      ) : (
        <Text style={styles.noQr}>No QR code available</Text>
      )}

      {nextBooking && (
        <View style={styles.bookingCard}>
          <Text style={styles.bookingService}>{nextBooking.serviceName}</Text>
          <Text style={styles.bookingTime}>{new Date(nextBooking.startTime).toLocaleString()}</Text>
        </View>
      )}

      <TouchableOpacity style={[styles.scanBtn, { backgroundColor: theme.colors.primary }]}>
        <Text style={styles.scanText}>Scan Venue QR</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', padding: 24, paddingTop: 60 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 32 },
  qrContainer: { alignItems: 'center', marginBottom: 32 },
  qrHint: { color: '#666', marginTop: 12, fontSize: 14 },
  noQr: { color: '#999', fontSize: 16, marginBottom: 32 },
  bookingCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, width: '100%', marginBottom: 24, elevation: 2 },
  bookingService: { fontSize: 16, fontWeight: '600' },
  bookingTime: { fontSize: 14, color: '#666', marginTop: 4 },
  scanBtn: { borderRadius: 10, padding: 16, width: '100%', alignItems: 'center' },
  scanText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
