Rebar Planner icon assets generated from the new no-PDF icon.

Copy the android/ and ios/ folders over your project root to replace matching files.
Upload store-assets/google-play-icon-512.png to Google Play > Store listing > App icon.
Optional: upload store-assets/google-play-feature-graphic-1024x500.png when Google asks for Feature graphic.

After replacing app icons, bump versions again:
Android: versionCode 3, versionName "1.0.2"
iOS: CURRENT_PROJECT_VERSION = 3; MARKETING_VERSION = 1.0.2;
Then run: npm run build && npx cap sync
Then rebuild the Android signed AAB.
