// Pieces reused by several customer screens.
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useT } from './i18n';
import { useCart } from './state';
import { colors, money } from './ui';

// Green bar at the bottom: "3 items · ₹245  View cart"
export function CartBar() {
  const cart = useCart();
  const t = useT();
  if (!cart.count) return null;
  return (
    <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.white }}>
      <Pressable
        onPress={() => router.push('/cart')}
        style={{ height: 58, borderRadius: 14, backgroundColor: colors.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 }}
        accessibilityRole="button"
      >
        <View>
          <Text style={{ color: colors.white, fontWeight: '600', fontSize: 13 }}>
            {cart.count} {t('items')} · {cart.merchant?.name}
          </Text>
          <Text style={{ color: colors.white, fontWeight: '800', fontSize: 19 }}>{money(cart.totalPaise)}</Text>
        </View>
        <Text style={{ color: colors.white, fontWeight: '800', fontSize: 16 }}>{t('cart')} ›</Text>
      </Pressable>
    </View>
  );
}

// Small green/brown square used in India to mark veg / non-veg food.
export function VegMark({ isVeg }) {
  if (isVeg === null || isVeg === undefined) return null;
  const c = isVeg ? '#15803D' : '#9A3412';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 14, height: 14, borderWidth: 1.5, borderColor: c, borderRadius: 2, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c }} />
      </View>
      <Text style={{ color: c, fontSize: 12, fontWeight: '700' }}>{isVeg ? 'Veg' : 'Non-veg'}</Text>
    </View>
  );
}

export const STATUS_TEXT = {
  awaiting_payment: 'Waiting for UPI payment',
  placed: 'Waiting for the shop',
  accepted: 'Shop accepted · packing soon',
  ready: 'Packed · waiting for rider',
  picked_up: 'On the way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  rejected: 'Shop could not take it',
  requested: 'Finding a driver',
  started: 'Ride in progress',
  completed: 'Completed',
};
