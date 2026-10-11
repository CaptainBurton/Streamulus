import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

// Release signing — the same key every time, so a new APK installs over the old one.
// GitHub Actions passes it in environment variables (from the repo's secrets); on your
// own computer, put keystore.properties (and the .jks it names) in mobile/android/.
// Neither is ever committed (see .gitignore).
val keystoreProperties = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
fun signingValue(env: String, property: String): String? =
    System.getenv(env)?.takeIf { it.isNotBlank() } ?: keystoreProperties.getProperty(property)
val releaseKeystore: File? = signingValue("STREAMULUS_KEYSTORE_FILE", "storeFile")
    ?.let { rootProject.file(it) }
    ?.takeIf { it.exists() }

// Each GitHub build gets a higher version code (its run number), which Android needs
// to install it as an update.
val buildNumber: Int = System.getenv("STREAMULUS_BUILD_NUMBER")?.toIntOrNull() ?: 1

android {
    namespace = "com.streamulus.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.streamulus.android"
        minSdk = 26
        targetSdk = 36 // Android 16
        versionCode = buildNumber
        versionName = "1.0.$buildNumber"
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = releaseKeystore
                storePassword = signingValue("STREAMULUS_KEYSTORE_PASSWORD", "storePassword")
                keyAlias = signingValue("STREAMULUS_KEY_ALIAS", "keyAlias")
                keyPassword = signingValue("STREAMULUS_KEY_PASSWORD", "keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Without a release key, fall back to the debug key so the APK still installs.
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    lint {
        // Don't fail release builds on lint findings (they're reported, not fatal).
        checkReleaseBuilds = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.compose.ui.tooling.preview)
    debugImplementation(libs.androidx.compose.ui.tooling)

    // Player: HLS streams from the server, Picture in Picture controls, Google Cast.
    implementation(libs.androidx.media3.exoplayer)
    implementation(libs.androidx.media3.exoplayer.hls)
    implementation(libs.androidx.media3.ui)
    implementation(libs.androidx.media3.session)
    implementation(libs.androidx.media3.cast)
    implementation(libs.androidx.fragment)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.mediarouter)

    // Approve a Sign-In: Google's QR scanner (no camera permission needed).
    implementation(libs.play.services.code.scanner)

    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.zxing.core)
}
