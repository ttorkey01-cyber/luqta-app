/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const light = {
    text: '#F6F1F8',
    tint: '#FF2DA8',
    background: '#09090D',
    foreground: '#F6F1F8',
    card: '#15151D',
    cardForeground: '#F6F1F8',
    primary: '#FF2DA8',
    primaryForeground: '#FFFFFF',
    secondary: '#20202A',
    secondaryForeground: '#F6F1F8',
    muted: '#23232D',
    mutedForeground: '#9D9AA8',
    accent: '#2ECAF2',
    accentForeground: '#FFFFFF',
    destructive: '#FF5E7A',
    destructiveForeground: '#FFFFFF',
    border: '#2A2A36',
    input: '#242430',

    // LUQTA-specific semantic tokens
    canvas: '#09090D',
    surface: '#14141B',
    surfaceRaised: '#1B1B25',
    ink: '#F6F1F8',
    inkSoft: '#B8B3C0',
    inkFaint: '#777381',
    line: 'rgba(255,255,255,0.10)',
    pink: '#FF2DA8',
    violet: '#9E4BFF',
    cyan: '#37D7F5',
    gold: '#F7C66A',
    success: '#72E1B3',
};

const colors = {
  ...light,
  light,
  radius: 24,
};

export default colors;
