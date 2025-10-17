import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import 'package:app_links/app_links.dart';

class OAuthService {
  static const String backendUrl = 'https://k2s.onrender.com';
  static const String callbackScheme = 'k2sdiag';

  static const String googleClientIdWeb =
      '461385830578-pbnq271ga15ggms5c4uckspo4480litm.apps.googleusercontent.com';

  static const String outlookClientId = 'VOTRE_CLIENT_ID_OUTLOOK';

  static final AppLinks _appLinks = AppLinks();

  static Completer<Uri?>? _authCompleter;
  static StreamSubscription? _linkSubscription;

  // ===== GMAIL avec protection contre les appels multiples =====
  static Future<Map<String, String>?> connectGmail() async {
    try {
      final scopes = [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
        'openid',
        'profile',
      ].join(' ');

      final authUrl = Uri.https('accounts.google.com', '/o/oauth2/v2/auth', {
        'client_id': googleClientIdWeb,
        'redirect_uri': '$backendUrl/oauth/google/callback',
        'response_type': 'code',
        'scope': scopes,
        'access_type': 'offline',
        'prompt': 'consent',
        'hl': 'fr', // 🔹 Langue française
      });

      print('🔗 [OAuth] Ouverture navigateur...');

      _authCompleter = Completer<Uri?>();

      // 🔹 CLEF: Variable pour tracker si on a déjà traité
      bool hasProcessed = false;

      _linkSubscription = _appLinks.uriLinkStream.listen(
        (Uri uri) {
          print('✅ [OAuth] Deep link reçu: ${uri.toString().substring(0, 100)}...');
          
          // 🔹 Ignorer si déjà traité
          if (hasProcessed) {
            print('⚠️ [OAuth] Deep link déjà traité, ignoré');
            return;
          }

          if (uri.scheme == callbackScheme &&
              _authCompleter != null &&
              !_authCompleter!.isCompleted) {
            
            hasProcessed = true; // 🔹 Marquer comme traité
            _authCompleter!.complete(uri);
          }
        },
        onError: (err) {
          print('❌ [OAuth] Erreur deep link: $err');
          if (_authCompleter != null && !_authCompleter!.isCompleted) {
            _authCompleter!.completeError(err);
          }
        },
      );

      final launched = await launchUrl(
        authUrl,
        mode: LaunchMode.externalApplication,
      );

      if (!launched) {
        print('❌ [OAuth] Impossible d\'ouvrir le navigateur');
        _cleanupAuth();
        return null;
      }

      print('⏳ [OAuth] Attente du callback...');

      final resultUri = await _authCompleter!.future.timeout(
        const Duration(minutes: 5),
        onTimeout: () {
          print('⏱️ [OAuth] Timeout après 5 minutes');
          return null;
        },
      );

      _cleanupAuth();

      if (resultUri == null) {
        print('⚠️ [OAuth] Aucun callback reçu (timeout ou annulation)');
        return null;
      }

      print('📋 [OAuth] URI reçu: ${resultUri.toString()}');

      final error = resultUri.queryParameters['error'];
      if (error != null) {
        print('❌ [OAuth] Erreur: $error');
        return null;
      }

      final accessToken = resultUri.queryParameters['access_token'];
      final refreshToken = resultUri.queryParameters['refresh_token'];
      final email = resultUri.queryParameters['email'];
      final idToken = resultUri.queryParameters['id_token'];

      print('📋 [OAuth] Paramètres reçus:');
      print('  - access_token: ${accessToken != null ? "✓" : "✗"}');
      print('  - refresh_token: ${refreshToken != null ? "✓" : "✗"}');
      print('  - email: ${email ?? "✗"}');

      if (accessToken == null || accessToken.isEmpty) {
        print('❌ [Gmail] access_token manquant');
        return null;
      }

      if (email == null || email.isEmpty) {
        print('❌ [Gmail] Email manquant');
        return null;
      }

      print('✅ [Gmail] Connexion réussie: $email');

      return {
        'access_token': accessToken,
        'refresh_token': refreshToken ?? '',
        'id_token': idToken ?? '',
        'email': email,
      };

    } catch (e, stackTrace) {
      print('❌ [Gmail] Erreur OAuth: $e');
      print('📄 Stack: $stackTrace');
      _cleanupAuth();
      return null;
    }
  }

  static void _cleanupAuth() {
    _linkSubscription?.cancel();
    _linkSubscription = null;
    _authCompleter = null;
  }

  // ===== GÉNÉRATEURS PKCE =====
  static String _generateCodeVerifier() {
    final random = Random.secure();
    final values = List<int>.generate(32, (i) => random.nextInt(256));
    return base64Url.encode(values).replaceAll('=', '');
  }

  static String _generateCodeChallenge(String verifier) {
    final bytes = utf8.encode(verifier);
    final digest = sha256.convert(bytes);
    return base64Url.encode(digest.bytes).replaceAll('=', '');
  }

  // ===== OUTLOOK (PKCE) =====
  static Future<Map<String, String>?> connectOutlook() async {
    try {
      final codeVerifier = _generateCodeVerifier();
      final codeChallenge = _generateCodeChallenge(codeVerifier);

      final authUrl =
      Uri.https('login.microsoftonline.com', '/common/oauth2/v2.0/authorize', {
        'client_id': outlookClientId,
        'redirect_uri': '$callbackScheme://auth',
        'response_type': 'code',
        'scope': 'offline_access User.Read Mail.Send Mail.Read',
        'response_mode': 'query',
        'prompt': 'consent',
        'code_challenge': codeChallenge,
        'code_challenge_method': 'S256',
      });

      print('🔗 [Outlook] Ouverture navigateur...');

      _authCompleter = Completer<Uri?>();
      bool hasProcessed = false;

      _linkSubscription = _appLinks.uriLinkStream.listen(
        (Uri uri) {
          if (hasProcessed) return;
          
          if (uri.scheme == callbackScheme &&
              _authCompleter != null &&
              !_authCompleter!.isCompleted) {
            hasProcessed = true;
            _authCompleter!.complete(uri);
          }
        },
        onError: (err) {
          if (_authCompleter != null && !_authCompleter!.isCompleted) {
            _authCompleter!.completeError(err);
          }
        },
      );

      final launched = await launchUrl(
        authUrl,
        mode: LaunchMode.externalApplication,
      );

      if (!launched) {
        _cleanupAuth();
        return null;
      }

      final resultUri = await _authCompleter!.future.timeout(
        const Duration(minutes: 5),
        onTimeout: () => null,
      );

      _cleanupAuth();

      if (resultUri == null) return null;

      final code = resultUri.queryParameters['code'];
      final error = resultUri.queryParameters['error'];

      if (error != null) {
        print('❌ [Outlook] OAuth error: $error');
        return null;
      }
      if (code == null) {
        print('❌ [Outlook] Code OAuth non reçu');
        return null;
      }

      print('🔄 [Outlook] Échange du code...');

      final tokenResponse = await http.post(
        Uri.parse('https://login.microsoftonline.com/common/oauth2/v2.0/token'),
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: {
          'client_id': outlookClientId,
          'code': code,
          'code_verifier': codeVerifier,
          'grant_type': 'authorization_code',
          'redirect_uri': '$callbackScheme://auth',
        },
      );

      if (tokenResponse.statusCode != 200) {
        print('❌ [Outlook] Erreur token: ${tokenResponse.body}');
        return null;
      }

      final data = json.decode(tokenResponse.body);

      String email = '';
      try {
        final userInfoResponse = await http.get(
          Uri.parse('https://graph.microsoft.com/v1.0/me'),
          headers: {'Authorization': 'Bearer ${data['access_token']}'},
        );
        if (userInfoResponse.statusCode == 200) {
          final userInfo = json.decode(userInfoResponse.body);
          email = userInfo['userPrincipalName'] ?? userInfo['mail'] ?? '';
          print('✅ [Outlook] Email: $email');
        }
      } catch (e) {
        print('⚠️ [Outlook] Erreur récupération email: $e');
      }

      return {
        'access_token': data['access_token'],
        'refresh_token': data['refresh_token'] ?? '',
        'id_token': data['id_token'] ?? '',
        'email': email,
      };
    } catch (e, stackTrace) {
      print('❌ [Outlook] Erreur OAuth: $e');
      print('📄 Stack: $stackTrace');
      _cleanupAuth();
      return null;
    }
  }

  // ===== WHATSAPP (via Backend) =====
  static Future<Map<String, String>?> connectWhatsApp() async {
    try {
      final url = Uri.parse('$backendUrl/api/auth/whatsapp/start');

      print('🔗 [WhatsApp] Ouverture navigateur...');

      _authCompleter = Completer<Uri?>();
      bool hasProcessed = false;

      _linkSubscription = _appLinks.uriLinkStream.listen(
        (Uri uri) {
          if (hasProcessed) return;
          
          if (uri.scheme == callbackScheme &&
              _authCompleter != null &&
              !_authCompleter!.isCompleted) {
            hasProcessed = true;
            _authCompleter!.complete(uri);
          }
        },
        onError: (err) {
          if (_authCompleter != null && !_authCompleter!.isCompleted) {
            _authCompleter!.completeError(err);
          }
        },
      );

      final launched = await launchUrl(
        url,
        mode: LaunchMode.externalApplication,
      );

      if (!launched) {
        _cleanupAuth();
        return null;
      }

      final resultUri = await _authCompleter!.future.timeout(
        const Duration(minutes: 5),
        onTimeout: () => null,
      );

      _cleanupAuth();

      if (resultUri == null) return null;

      final code = resultUri.queryParameters['code'];
      if (code == null) {
        print('❌ [WhatsApp] Code OAuth non reçu');
        return null;
      }

      print('🔄 [WhatsApp] Échange du code...');

      final response = await http.post(
        Uri.parse('$backendUrl/api/auth/whatsapp/callback'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({'code': code}),
      );

      if (response.statusCode != 200) {
        print('❌ [WhatsApp] Erreur serveur: ${response.statusCode}');
        return null;
      }

      final data = json.decode(response.body);
      print('✅ [WhatsApp] Connexion réussie');

      return {
        'access_token': data['access_token'],
        'phone_number_id': data['phone_number_id'],
        'business_account_id': data['business_account_id'],
      };
    } catch (e, stackTrace) {
      print('❌ [WhatsApp] Erreur OAuth: $e');
      print('📄 Stack: $stackTrace');
      _cleanupAuth();
      return null;
    }
  }

  // ===== Initialisation globale =====
  static Future<void> initDeepLinks() async {
    try {
      final initialUri = await _appLinks.getInitialLink();
      if (initialUri != null) {
        print('📱 [DeepLink] Initial URI: $initialUri');
      }
    } catch (e) {
      print('❌ [DeepLink] Erreur initial: $e');
    }
  }
}
