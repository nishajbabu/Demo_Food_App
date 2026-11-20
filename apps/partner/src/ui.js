// Shared look: colours and small building blocks used on every screen.
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

export const colors = {
  green: '#0E7A45',
  greenDark: '#0A5C34',
  greenTint: '#E7F4EC',
  marigold: '#F5A623',
  marigoldTint: '#FEF3DE',
  brown: '#A15C00',
  orangeTint: '#FDEBDD',
  orange: '#C2410C',
  blueTint: '#E6F0FB',
  blue: '#1D5FB4',
  red: '#B42318',
  redTint: '#FDECEA',
  ink: '#1B1F1C',
  muted: '#5B625D',
  line: '#E3E8E4',
  bg: '#F4F5F2',
  white: '#FFFFFF',
};

// ₹1,234 or ₹12.50 from paise
export function money(paise) {
  const rupees = Math.round(paise) / 100;
  const [whole, dec] = rupees.toFixed(2).split('.');
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `₹${grouped}${dec === '00' ? '' : `.${dec}`}`;
}

export function Screen({ children, scroll = true, padded = true, style }) {
  const inner = padded ? { padding: 16, gap: 14 } : null;
  if (!scroll) return <View style={[{ flex: 1, backgroundColor: colors.white }, inner, style]}>{children}</View>;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.white }} contentContainerStyle={[inner, { paddingBottom: 40 }, style]} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Card({ children, style, onPress }) {
  const s = [styles.card, style];
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [s, pressed && { opacity: 0.7 }]}>
        {children}
      </Pressable>
    );
  }
  return <View style={s}>{children}</View>;
}

export function Button({ title, onPress, kind = 'primary', disabled, loading, style }) {
  const look = {
    primary: { bg: colors.green, fg: colors.white, border: colors.green },
    outline: { bg: colors.white, fg: colors.green, border: colors.green },
    danger: { bg: colors.white, fg: colors.red, border: colors.red },
    dark: { bg: colors.ink, fg: colors.white, border: colors.ink },
  }[kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: look.bg, borderColor: look.border, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={look.fg} /> : <Text style={[styles.buttonText, { color: look.fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Pill({ label, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.pill, selected && { backgroundColor: colors.green, borderColor: colors.green }]}
    >
      <Text style={[styles.pillText, selected && { color: colors.white }]}>{label}</Text>
    </Pressable>
  );
}

export function Stepper({ qty, onAdd, onRemove, addLabel = 'ADD' }) {
  if (!qty) {
    return (
      <Pressable onPress={onAdd} style={styles.addBtn} accessibilityRole="button">
        <Text style={styles.addText}>{addLabel}</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.stepper}>
      <Pressable onPress={onRemove} style={styles.stepBtn} accessibilityLabel="Remove one">
        <Text style={styles.stepText}>−</Text>
      </Pressable>
      <Text style={[styles.stepText, { fontSize: 16 }]}>{qty}</Text>
      <Pressable onPress={onAdd} style={styles.stepBtn} accessibilityLabel="Add one">
        <Text style={styles.stepText}>+</Text>
      </Pressable>
    </View>
  );
}

export function Field({ label, ...props }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput placeholderTextColor="#7A817C" style={styles.input} {...props} />
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ padding: 40, alignItems: 'center' }}>
      <ActivityIndicator size="large" color={colors.green} />
    </View>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <View style={styles.error}>
      <Text style={{ color: colors.red, fontWeight: '600' }}>{String(error.message || error)}</Text>
      {onRetry ? <Button title="Try again" kind="danger" onPress={onRetry} style={{ marginTop: 8 }} /> : null}
    </View>
  );
}

export function Empty({ text }) {
  return <Text style={{ color: colors.muted, textAlign: 'center', padding: 24, fontSize: 15 }}>{text}</Text>;
}

export const H1 = ({ children, style }) => <Text style={[styles.h1, style]}>{children}</Text>;
export const H2 = ({ children, style }) => <Text style={[styles.h2, style]}>{children}</Text>;
export const Muted = ({ children, style }) => <Text style={[styles.muted, style]}>{children}</Text>;

export const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 14, backgroundColor: colors.white, gap: 6 },
  button: { minHeight: 52, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonText: { fontSize: 16, fontWeight: '800' },
  pill: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1.5, borderColor: '#D9E3DC', justifyContent: 'center', backgroundColor: colors.white },
  pillText: { fontSize: 14, fontWeight: '700', color: colors.ink },
  addBtn: { width: 88, height: 44, borderRadius: 10, borderWidth: 1.5, borderColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  addText: { color: colors.green, fontWeight: '800', fontSize: 15 },
  stepper: { width: 100, height: 44, borderRadius: 10, backgroundColor: colors.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepBtn: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: colors.white, fontWeight: '800', fontSize: 20 },
  label: { fontSize: 14, fontWeight: '700', color: colors.ink },
  input: { minHeight: 50, borderWidth: 1.5, borderColor: '#B8BFBA', borderRadius: 12, paddingHorizontal: 14, fontSize: 17, color: colors.ink, backgroundColor: colors.white },
  error: { backgroundColor: colors.redTint, borderRadius: 12, padding: 12 },
  h1: { fontSize: 26, fontWeight: '800', color: colors.ink },
  h2: { fontSize: 19, fontWeight: '800', color: colors.ink },
  muted: { fontSize: 14, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
