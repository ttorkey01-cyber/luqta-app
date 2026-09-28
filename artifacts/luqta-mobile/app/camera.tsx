import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { GradientButton, heroImage } from '@/components/LuqtaUI';
import { visualSearchService } from '@/services/visualSearchService';

export default function CameraScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [cameraFacing, setCameraFacing] = useState<'back' | 'front'>('back');
  const [selectedUri, setSelectedUri] = useState<string | null>(null);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (!result.canceled) setSelectedUri(result.assets[0]?.uri ?? null);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('نحتاج إذن الكاميرا', 'فعّل إذن الكاميرا من إعدادات جهازك لاستخدام البحث بالصورة.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (!result.canceled) setSelectedUri(result.assets[0]?.uri ?? null);
  };

  const confirmSearch = async () => {
    if (!selectedUri) {
      await takePhoto();
      return;
    }
    await visualSearchService.search(selectedUri);
    router.push({ pathname: '/results', params: { query: 'كرسي', visual: 'demo' } });
  };

  const snap = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    void confirmSearch();
  };

  return (
    <View style={styles.root}>
      <ImageBackground source={selectedUri ? { uri: selectedUri } : heroImage} style={styles.preview} imageStyle={styles.previewImage}>
        <LinearGradient colors={['rgba(5,5,8,0.72)', 'rgba(5,5,8,0.12)', 'rgba(5,5,8,0.84)']} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
        <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}><Feather name="x" size={21} color={colors.ink} /></Pressable>
          <Text style={styles.cameraTitle}>البحث بالصورة</Text>
          <Pressable style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}><Feather name="zap" size={18} color={colors.gold} /></Pressable>
        </View>
        <View style={styles.cameraCenter}>
          <Text style={styles.instruction}>{selectedUri ? 'تأكد من الصورة' : 'وجّه الكاميرا للمنتج'}</Text>
          <View style={styles.frame}>
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
          </View>
          <Text style={styles.helper}>{selectedUri ? 'الصورة جاهزة للبحث التجريبي' : 'خلّ المنتج داخل الإطار عشان نبحث عنه'}</Text>
        </View>
        {selectedUri ? (
          <View style={styles.confirmButton}>
            <GradientButton label="تأكيد البحث" icon="search" onPress={confirmSearch} small />
          </View>
        ) : null}
        <View style={[styles.bottomControls, { paddingBottom: insets.bottom + 24 }]}>
          <Pressable onPress={pickImage} style={({ pressed }) => [styles.controlButton, pressed && styles.pressed]}><Feather name="image" size={23} color={colors.ink} /><Text style={styles.controlLabel}>المعرض</Text></Pressable>
          <Pressable onPress={snap} style={({ pressed }) => [styles.shutterOuter, pressed && styles.shutterPressed]}><View style={styles.shutterInner} /></Pressable>
          <Pressable onPress={() => setCameraFacing(cameraFacing === 'back' ? 'front' : 'back')} style={({ pressed }) => [styles.controlButton, pressed && styles.pressed]}><Feather name="refresh-cw" size={23} color={colors.ink} /><Text style={styles.controlLabel}>تبديل</Text></Pressable>
        </View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050508' },
  preview: { flex: 1, justifyContent: 'space-between' },
  previewImage: { opacity: 0.86 },
  topBar: { paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cameraTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  roundButton: { width: 42, height: 42, borderRadius: 15, backgroundColor: 'rgba(9,9,13,0.54)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.13)' },
  cameraCenter: { alignItems: 'center', justifyContent: 'center', marginTop: -42 },
  instruction: { color: colors.ink, fontSize: 19, fontWeight: '800', marginBottom: 24 },
  frame: { width: '72%', aspectRatio: 0.92, position: 'relative' },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: colors.ink, borderWidth: 3 },
  cornerTopRight: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 8 },
  cornerTopLeft: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 8 },
  cornerBottomRight: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 8 },
  cornerBottomLeft: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 8 },
  helper: { color: 'rgba(246,241,248,0.7)', fontSize: 11, marginTop: 20 },
  bottomControls: { paddingHorizontal: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  confirmButton: { paddingHorizontal: 54, marginBottom: -5 },
  controlButton: { alignItems: 'center', gap: 8, minWidth: 45 },
  controlLabel: { color: colors.inkSoft, fontSize: 10, fontWeight: '700' },
  shutterOuter: { width: 74, height: 74, borderRadius: 37, borderWidth: 3, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 57, height: 57, borderRadius: 29, backgroundColor: colors.ink, borderWidth: 4, borderColor: colors.pink },
  shutterPressed: { transform: [{ scale: 0.9 }], opacity: 0.8 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.95 }] },
});