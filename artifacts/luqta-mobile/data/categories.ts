import type { ImageSourcePropType } from 'react-native';
import type { Feather } from '@expo/vector-icons';
import {
  LuqtaCategory as LuqtaCategoryValues,
  type ProductSearchRequest,
} from '@workspace/api-client-react';

const bag = require('@/assets/images/luqta-bag.jpg') as ImageSourcePropType;
const chair = require('@/assets/images/luqta-chair.jpg') as ImageSourcePropType;
const watch = require('@/assets/images/luqta-watch.jpg') as ImageSourcePropType;

export type LuqtaCategory = {
  label: string;
  query: string;
  id: NonNullable<ProductSearchRequest['category']>;
  artwork: CategoryArtworkKind;
  glow: string;
};

export type CategoryArtworkKind =
  | 'dress'
  | 'beauty'
  | 'handbag'
  | 'watch'
  | 'laptop'
  | 'chair'
  | 'sneaker'
  | 'sunglasses'
  | 'car'
  | 'teddy'
  | 'dumbbell'
  | 'controller';

export const categories: LuqtaCategory[] = [
  { label: 'الأزياء والملابس', query: 'الأزياء والملابس', id: LuqtaCategoryValues.fashion, artwork: 'dress', glow: '#FF2DA8' },
  { label: 'الجمال والعناية', query: 'الجمال والعناية', id: LuqtaCategoryValues.beauty_care, artwork: 'beauty', glow: '#9E4BFF' },
  { label: 'الحقائب والإكسسوارات', query: 'الحقائب والإكسسوارات', id: LuqtaCategoryValues.bags_accessories, artwork: 'handbag', glow: '#37D7F5' },
  { label: 'الساعات والمجوهرات', query: 'الساعات والمجوهرات', id: LuqtaCategoryValues.watches_jewelry, artwork: 'watch', glow: '#F7C66A' },
  { label: 'الإلكترونيات', query: 'الإلكترونيات', id: LuqtaCategoryValues.electronics, artwork: 'laptop', glow: '#37D7F5' },
  { label: 'المنزل والمعيشة', query: 'المنزل والمعيشة', id: LuqtaCategoryValues.home_living, artwork: 'chair', glow: '#72E1B3' },
  { label: 'الأحذية', query: 'الأحذية', id: LuqtaCategoryValues.shoes, artwork: 'sneaker', glow: '#FF2DA8' },
  { label: 'النظارات', query: 'النظارات', id: LuqtaCategoryValues.eyewear, artwork: 'sunglasses', glow: '#9E4BFF' },
  { label: 'السيارات وقطع الغيار', query: 'السيارات وقطع الغيار', id: LuqtaCategoryValues.automotive, artwork: 'car', glow: '#F7C66A' },
  { label: 'الأطفال والمواليد', query: 'الأطفال والمواليد', id: LuqtaCategoryValues.kids_baby, artwork: 'teddy', glow: '#72E1B3' },
  { label: 'الرياضة واللياقة', query: 'الرياضة واللياقة', id: LuqtaCategoryValues.sports_fitness, artwork: 'dumbbell', glow: '#37D7F5' },
  { label: 'الألعاب والهوايات', query: 'الألعاب والهوايات', id: LuqtaCategoryValues.games_hobbies, artwork: 'controller', glow: '#FF2DA8' },
];