# LUQTA Android over-the-air updates

The `production-test` build is an internal APK subscribed to the **production**
EAS Update channel of the existing `@luqta-app/luqta` project. Its embedded
backend setting remains `EXPO_PUBLIC_DOMAIN=luqta-mobile-shopping-app--ttorkey01.replit.app`.
The current installed APK predates `expo-updates` and has no channel or runtime
version. **Build and install one new `production-test` APK before OTA can work.**
This document does not build, publish, or automatically update anything.

## Publish a tested JS-only Android change

1. Test the change and run the workspace typecheck and relevant tests.
2. Check that native dependencies, Expo plugins, permissions, SDK, package lock,
   and native configuration have not changed since the installed APK. The
   `fingerprint` runtime policy derives compatibility from the native project;
   a new native fingerprint requires a new APK.
3. Commit and push the approved source to GitHub `main`.
4. Confirm the EAS **production** environment does not define a conflicting
   `EXPO_PUBLIC_DOMAIN`. From `artifacts/luqta-mobile`, after authenticating an
   EAS CLI session, publish only after explicit approval:

   ```sh
   EXPO_PUBLIC_DOMAIN=luqta-mobile-shopping-app--ttorkey01.replit.app eas update --channel production --environment production --platform android --message "Describe the tested fix"
   ```

   Expo SDK 57 requires `--environment production`. The inline public domain
   preserves the same backend as the APK build profile; if EAS also defines
   `EXPO_PUBLIC_DOMAIN` in its production environment, it must match. Do not use
   a development, Expo Go, Metro, preview, or `.replit.dev` backend for updates.
   A published update is checked on app launch and normally applied on the
   following launch. Publishing does not deploy the API server.

**OTA-safe:** JavaScript/TypeScript fixes, UI text/styles, and bundled assets
that use native capabilities already present in the installed APK.

**New APK required:** Native dependency or plugin changes, Expo SDK changes,
Android permissions or package/native configuration changes, and any change
that alters the computed native fingerprint. Build and install a compatible
APK before publishing updates for its new runtime. Never republish a new-runtime
update to an older APK merely by changing its channel.

The Luxury Closet image correction also changes the API provider mapping.
Publishing the mobile bundle by OTA cannot deploy that server-side change.