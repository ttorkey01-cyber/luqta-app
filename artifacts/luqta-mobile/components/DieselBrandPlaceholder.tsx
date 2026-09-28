import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import colors from '@/constants/colors';

const dieselLogo = require('@/assets/images/diesel-logo.jpg');

export function DieselBrandPlaceholder({
  compact = false,
  large = false,
}: {
  compact?: boolean;
  large?: boolean;
}) {
  return (
    <View
      style={[styles.container, compact && styles.compact]}
      accessibilityLabel="شعار ديزل، صورة المنتج غير متوفرة"
      testID="diesel-brand-placeholder"
    >
      <Image
        source={dieselLogo}
        style={compact ? styles.compactLogo : large ? styles.largeLogo : styles.logo}
        resizeMode="contain"
        accessibilityLabel="شعار ديزل"
      />
      {!compact && (
        <Text style={styles.caption}>شعار ديزل · ليست صورة المنتج</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.surfaceRaised,
  },
  compact: { gap: 0 },
  logo: { width: 150, height: 100, borderRadius: 8 },
  largeLogo: { width: 210, height: 170, borderRadius: 10 },
  compactLogo: { width: 40, height: 40 },
  caption: { color: colors.inkFaint, fontSize: 10, fontWeight: '700', textAlign: 'center' },
});