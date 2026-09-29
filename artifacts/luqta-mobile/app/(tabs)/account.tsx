import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import colors from '@/constants/colors';
import { BottomNav, Header, Screen } from '@/components/LuqtaUI';

const rows: { label: string; icon: keyof typeof Feather.glyphMap; route?: '/' | '/favorites' | '/hunt' | '/provider-health' }[] = [
  { label: 'طلباتي', icon: 'package' },
  { label: 'مفضلاتي', icon: 'heart', route: '/favorites' },
  { label: 'صِدها لي', icon: 'target', route: '/hunt' },
  { label: 'الإعدادات', icon: 'settings' },
  { label: 'صحة صور المزوّدين', icon: 'activity', route: '/provider-health' },
  { label: 'المساعدة', icon: 'help-circle' },
  { label: 'عن لُقطة', icon: 'info' },
];

export default function AccountScreen() {
  const router = useRouter();
  return (
    <View style={styles.root}>
      <Screen>
        <Header title="حسابي" subtitle="كل شيء تحت سيطرتك" actionIcon="bell" />
        <View style={styles.profileCard}>
          <View style={styles.avatar}><Text style={styles.avatarText}>TS</Text></View>
          <View style={styles.profileInfo}><Text style={styles.profileName}>Turki Sehili</Text><Text style={styles.profileEmail}>turki@example.com</Text></View>
          <Pressable style={styles.editButton}><Feather name="edit-2" size={15} color={colors.inkSoft} /></Pressable>
        </View>
        <View style={styles.menu}>
          {rows.map((row) => (
            <Pressable key={row.label} onPress={() => row.route && router.push(row.route)} style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
              <Feather name="chevron-left" size={16} color={colors.inkFaint} />
              <Text style={styles.menuLabel}>{row.label}</Text>
              <View style={styles.menuIcon}><Feather name={row.icon} size={17} color={colors.inkSoft} /></View>
            </Pressable>
          ))}
        </View>
        <Pressable style={({ pressed }) => [styles.logout, pressed && styles.pressed]}><Feather name="log-out" size={16} color={colors.pink} /><Text style={styles.logoutText}>تسجيل الخروج</Text></Pressable>
        <View style={styles.version}><Text style={styles.versionText}>لُقطة · الإصدار ١.٠</Text></View>
      </Screen>
      <BottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  profileCard: { padding: 17, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', marginBottom: 19 },
  avatar: { width: 50, height: 50, borderRadius: 18, backgroundColor: '#31284D', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.cyan, fontSize: 16, fontWeight: '900' },
  profileInfo: { flex: 1, marginLeft: 12 },
  profileName: { color: colors.ink, fontSize: 14, fontWeight: '800', textAlign: 'left' },
  profileEmail: { color: colors.inkFaint, fontSize: 11, marginTop: 4, textAlign: 'left' },
  editButton: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  menu: { borderRadius: 22, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  menuRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 15, borderBottomWidth: 1, borderBottomColor: colors.line },
  menuLabel: { color: colors.ink, flex: 1, textAlign: 'right', fontSize: 13, fontWeight: '700' },
  menuIcon: { width: 31, height: 31, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  logout: { height: 52, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(255,45,168,0.3)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, marginTop: 19 },
  logoutText: { color: colors.pink, fontSize: 13, fontWeight: '800' },
  version: { alignItems: 'center', marginTop: 24 },
  versionText: { color: colors.inkFaint, fontSize: 10 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
});