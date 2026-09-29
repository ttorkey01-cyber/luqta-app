import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, ImageBackground, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { GradientButton, heroImage } from '@/components/LuqtaUI';
import {
  jpegDataUrlFromBase64,
  mergeVisualSearchQuery,
  needsImageConfirmation,
  visualSearchService,
  type ImageCandidate,
  type ImageUnderstanding,
} from '@/services/visualSearchService';

type SelectedImage = { uri: string; dataUrl: string };

export default function CameraScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [cameraFacing, setCameraFacing] = useState<'back' | 'front'>('back');
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null);
  const [userText, setUserText] = useState('');
  const [understanding, setUnderstanding] = useState<ImageUnderstanding | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<ImageCandidate | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const acceptImage = (asset: ImagePicker.ImagePickerAsset | undefined) => {
    if (!asset) return;
    try {
      setSelectedImage({
        uri: asset.uri,
        dataUrl: jpegDataUrlFromBase64(asset.base64, asset.mimeType),
      });
      setUnderstanding(null);
      setSelectedCandidate(null);
    } catch (error) {
      Alert.alert(
        'تعذّر تجهيز الصورة',
        error instanceof Error ? error.message : 'اختر صورة JPEG أصغر وحاول مجدداً.',
      );
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.65,
      base64: true,
      allowsEditing: true,
    });
    if (!result.canceled) acceptImage(result.assets[0]);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('نحتاج إذن الكاميرا', 'فعّل إذن الكاميرا من إعدادات جهازك لاستخدام البحث بالصورة.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.65,
      base64: true,
      cameraType:
        cameraFacing === 'back'
          ? ImagePicker.CameraType.back
          : ImagePicker.CameraType.front,
    });
    if (!result.canceled) acceptImage(result.assets[0]);
  };

  const openSearchResults = (query: string) => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return;
    router.push({ pathname: '/results', params: { query: normalizedQuery, visual: 'true' } });
  };

  const interpretImage = async () => {
    if (!selectedImage) {
      await takePhoto();
      return;
    }
    setIsAnalyzing(true);
    setUnderstanding(null);
    setSelectedCandidate(null);
    try {
      const result = await visualSearchService.interpret(
        selectedImage.dataUrl,
        userText,
      );
      setUnderstanding(result);
      if (!needsImageConfirmation(result) && result.primaryCandidate) {
        openSearchResults(
          mergeVisualSearchQuery(result.primaryCandidate, userText),
        );
      }
    } catch (error) {
      Alert.alert(
        'تعذّر تحليل الصورة',
        error instanceof Error
          ? error.message
          : 'تحقّق من اتصالك بالإنترنت ثم حاول مرة أخرى.',
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const snap = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (!selectedImage) void takePhoto();
    else void interpretImage();
  };

  const searchSelectedCandidate = () => {
    if (selectedCandidate) {
      openSearchResults(mergeVisualSearchQuery(selectedCandidate, userText));
    } else if (userText.trim()) {
      openSearchResults(userText);
    }
  };

  return (
    <View style={styles.root}>
      <ImageBackground source={selectedImage ? { uri: selectedImage.uri } : heroImage} style={styles.preview} imageStyle={styles.previewImage}>
        <LinearGradient colors={['rgba(5,5,8,0.72)', 'rgba(5,5,8,0.12)', 'rgba(5,5,8,0.84)']} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
        <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}><Feather name="x" size={21} color={colors.ink} /></Pressable>
          <Text style={styles.cameraTitle}>البحث بالصورة</Text>
          <Pressable style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}><Feather name="zap" size={18} color={colors.gold} /></Pressable>
        </View>
        <ScrollView
          style={styles.cameraCenter}
          contentContainerStyle={styles.cameraCenterContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.instruction}>
            {isAnalyzing
              ? 'نحلّل المنتج الظاهر'
              : selectedImage
                ? understanding?.needsConfirmation
                  ? 'ماذا ترى لُقطة في الصورة؟'
                  : 'تأكد من الصورة'
                : 'وجّه الكاميرا للمنتج'}
          </Text>
          <View style={styles.frame}>
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
          </View>
          <Text style={styles.helper}>
            {selectedImage
              ? understanding?.needsConfirmation
                ? 'اختر اقتراحاً أو عدّل وصفك قبل البحث'
                : 'أضف وصفاً أو قيوداً لتضييق النتائج'
              : 'خلّ المنتج داخل الإطار عشان نبحث عنه'}
          </Text>
          {understanding?.needsConfirmation ? (
            <View style={styles.candidateList}>
              {[understanding.primaryCandidate, ...understanding.alternatives]
                .filter((candidate): candidate is ImageCandidate => Boolean(candidate))
                .map((candidate, index) => {
                  const selected = selectedCandidate?.query === candidate.query;
                  return (
                    <Pressable
                      key={`${candidate.query}-${index}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setSelectedCandidate(candidate)}
                      style={[
                        styles.candidate,
                        selected && styles.candidateSelected,
                      ]}
                    >
                      <Text style={styles.candidateName}>{candidate.name}</Text>
                      <Text style={styles.candidateConfidence}>
                        {Math.round(candidate.confidence * 100)}%
                      </Text>
                    </Pressable>
                  );
                })}
              {understanding.primaryCandidate === null &&
              understanding.alternatives.length === 0 ? (
                <Text style={styles.noCandidate}>
                  لم نستطع تحديد المنتج. اكتب وصفاً واضحاً للبحث بالنص.
                </Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
        <View style={styles.searchPanel}>
          <TextInput
            value={userText}
            onChangeText={setUserText}
            editable={!isAnalyzing}
            maxLength={200}
            placeholder="مثال: أبغى نفس هذا بس أسود وأقل من 300"
            placeholderTextColor={colors.inkFaint}
            textAlign="right"
            style={styles.searchInput}
            accessibilityLabel="وصف وقيود البحث بالصورة"
            returnKeyType="done"
          />
          {understanding?.needsConfirmation ? (
            <Pressable
              accessibilityRole="button"
              disabled={!selectedCandidate && !userText.trim()}
              onPress={searchSelectedCandidate}
              style={({ pressed }) => [
                styles.confirmButton,
                (!selectedCandidate && !userText.trim()) && styles.disabledButton,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="search" size={16} color={colors.ink} />
              <Text style={styles.confirmText}>
                {selectedCandidate ? 'ابحث بهذا الاقتراح' : 'ابحث بالنص'}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {selectedImage && !understanding?.needsConfirmation ? (
          <View style={styles.confirmButtonWrap}>
            <GradientButton
              label={isAnalyzing ? 'جارٍ تحليل الصورة' : 'تحليل الصورة'}
              icon="search"
              onPress={interpretImage}
              small
              disabled={isAnalyzing}
            />
          </View>
        ) : null}
        <View style={[styles.bottomControls, { paddingBottom: insets.bottom + 24 }]}>
          <Pressable onPress={pickImage} style={({ pressed }) => [styles.controlButton, pressed && styles.pressed]}><Feather name="image" size={23} color={colors.ink} /><Text style={styles.controlLabel}>المعرض</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={selectedImage ? 'حلّل الصورة' : 'التقط صورة'} disabled={isAnalyzing} onPress={snap} style={({ pressed }) => [styles.shutterOuter, pressed && styles.shutterPressed, isAnalyzing && styles.disabledButton]}>{isAnalyzing ? <ActivityIndicator color={colors.pink} /> : <View style={styles.shutterInner} />}</Pressable>
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
  cameraCenter: { flexGrow: 0, maxHeight: '58%', marginTop: -42 },
  cameraCenterContent: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  instruction: { color: colors.ink, fontSize: 19, fontWeight: '800', marginBottom: 24 },
  frame: { width: '72%', aspectRatio: 0.92, position: 'relative' },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: colors.ink, borderWidth: 3 },
  cornerTopRight: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 8 },
  cornerTopLeft: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 8 },
  cornerBottomRight: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 8 },
  cornerBottomLeft: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 8 },
  helper: { color: 'rgba(246,241,248,0.7)', fontSize: 11, marginTop: 20 },
  candidateList: { width: '100%', marginTop: 14, gap: 7 },
  candidate: { minHeight: 42, paddingHorizontal: 12, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(9,9,13,0.58)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  candidateSelected: { borderColor: colors.cyan, backgroundColor: 'rgba(70,220,230,0.13)' },
  candidateName: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  candidateConfidence: { color: colors.inkFaint, fontSize: 10 },
  noCandidate: { color: colors.inkSoft, fontSize: 11, textAlign: 'center', marginTop: 8 },
  searchPanel: { paddingHorizontal: 24, gap: 9, marginBottom: 8 },
  searchInput: { minHeight: 42, borderRadius: 13, paddingHorizontal: 13, color: colors.ink, backgroundColor: 'rgba(9,9,13,0.64)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', fontSize: 12 },
  confirmText: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  disabledButton: { opacity: 0.5 },
  confirmButtonWrap: { alignItems: 'center', marginBottom: 8 },
  bottomControls: { paddingHorizontal: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  confirmButton: { minHeight: 42, paddingHorizontal: 17, borderRadius: 14, backgroundColor: 'rgba(9,9,13,0.78)', borderWidth: 1, borderColor: colors.cyan, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  controlButton: { alignItems: 'center', gap: 8, minWidth: 45 },
  controlLabel: { color: colors.inkSoft, fontSize: 10, fontWeight: '700' },
  shutterOuter: { width: 74, height: 74, borderRadius: 37, borderWidth: 3, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 57, height: 57, borderRadius: 29, backgroundColor: colors.ink, borderWidth: 4, borderColor: colors.pink },
  shutterPressed: { transform: [{ scale: 0.9 }], opacity: 0.8 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.95 }] },
});