import { Image, type ImageSourcePropType, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { CategoryArtworkKind } from '@/data/categories';

const artworkAssets: Record<CategoryArtworkKind, ImageSourcePropType> = {
  dress: require('@/assets/images/category-dress.png') as ImageSourcePropType,
  beauty: require('@/assets/images/category-beauty.png') as ImageSourcePropType,
  handbag: require('@/assets/images/category-handbag.png') as ImageSourcePropType,
  watch: require('@/assets/images/category-watch.png') as ImageSourcePropType,
  laptop: require('@/assets/images/category-laptop.png') as ImageSourcePropType,
  chair: require('@/assets/images/category-chair.png') as ImageSourcePropType,
  sneaker: require('@/assets/images/category-sneaker.png') as ImageSourcePropType,
  sunglasses: require('@/assets/images/category-sunglasses.png') as ImageSourcePropType,
  car: require('@/assets/images/category-car.png') as ImageSourcePropType,
  teddy: require('@/assets/images/category-teddy.png') as ImageSourcePropType,
  dumbbell: require('@/assets/images/category-dumbbell.png') as ImageSourcePropType,
  controller: require('@/assets/images/category-controller.png') as ImageSourcePropType,
};

export function CategoryArtwork({
  kind,
  accent,
  compact = false,
}: {
  kind: CategoryArtworkKind;
  accent: string;
  compact?: boolean;
}) {
  return (
    <View style={[styles.frame, compact ? styles.frameCompact : styles.frameFull]}>
      <LinearGradient
        colors={['transparent', `${accent}18`, 'transparent']}
        locations={[0.08, 0.54, 1]}
        start={{ x: 0.08, y: 0 }}
        end={{ x: 0.92, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Image
        source={artworkAssets[kind]}
        resizeMode="contain"
        style={[styles.product, compact ? styles.productCompact : styles.productFull]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  frameCompact: { height: 109 },
  frameFull: { height: 146 },
  product: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  productCompact: { width: '94%', height: '112%' },
  productFull: { width: '96%', height: '112%' },
});