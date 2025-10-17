import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:hive/hive.dart';
import 'package:flutter/material.dart';
import '../ia_conect/ai_settings_model.dart';
import '../ia_conect/prestation_model.dart';
import '../ia_conect/appointment_model.dart';

/// 🔄 Service de synchronisation avec retry automatique
class SyncService {
  static const String baseUrl = 'https://k2s.onrender.com/api';
  static const int maxRetries = 2;
  static const Duration retryDelay = Duration(seconds: 3);

  /// 📤 Synchroniser les paramètres IA
  static Future<bool> syncAISettings(AISettingsModel settings, {BuildContext? context}) async {
    return await _syncWithRetry(
      endpoint: '/user/ai-settings',
      data: {
        'isEnabled': settings.isEnabled,
        'autoReplyEnabled': settings.autoReplyEnabled,
        'requireValidation': settings.requireValidation,
        'salonName': settings.salonName,
        'ownerEmail': settings.ownerEmail,
        'ownerPhone': settings.ownerPhone,
        'address': settings.address,
        'website': settings.website,
        'description': settings.description,
        'role': settings.role,
        'instructions': settings.instructions,
        'tone': settings.tone,
        'pricing': settings.pricing,
        'schedule': settings.schedule,
        'apiKey': settings.apiKey,
        'aiModel': settings.aiModel,
        'temperature': settings.temperature,
        'maxTokens': settings.maxTokens,
      },
      dataType: 'Paramètres IA',
      context: context,
    );
  }

  /// 📤 Synchroniser une prestation
  static Future<bool> syncPrestation(PrestationModel prestation, {BuildContext? context}) async {
    return await _syncWithRetry(
      endpoint: '/prestations',
      data: {
        'id': prestation.id,
        'name': prestation.name,
        'category': prestation.category,
        'defaultDurationMinutes': prestation.defaultDurationMinutes,
        'defaultPrice': prestation.defaultPrice,
        'colorCode': prestation.colorCode,
        'isActive': prestation.isActive,
      },
      dataType: 'Prestation',
      context: context,
    );
  }

  /// 📤 Synchroniser un rendez-vous
  static Future<bool> syncAppointment(AppointmentModel appointment, {BuildContext? context}) async {
    return await _syncWithRetry(
      endpoint: '/appointments',
      data: {
        'id': appointment.id,
        'clientName': appointment.clientName,
        'clientPhone': appointment.clientPhone,
        'clientEmail': appointment.clientEmail,
        'dateTime': appointment.dateTime.toIso8601String(),
        'durationMinutes': appointment.durationMinutes,
        'prestationName': appointment.prestationName,
        'prestationType': appointment.prestationType,
        'status': appointment.status,
        'notes': appointment.notes,
      },
      dataType: 'Rendez-vous',
      context: context,
    );
  }

  /// 🔄 Fonction générique avec retry automatique
  static Future<bool> _syncWithRetry({
    required String endpoint,
    required Map<String, dynamic> data,
    required String dataType,
    BuildContext? context,
  }) async {
    final box = Hive.box('email_config');
    final accessToken = box.get('access_token');

    if (accessToken == null) {
      print('⚠️ [Sync] Pas de token, sync ignorée');
      return false;
    }

    int attempt = 0;
    Exception? lastError;

    while (attempt <= maxRetries) {
      try {
        print('🔄 [Sync] Tentative ${attempt + 1}/${maxRetries + 1} - $dataType');

        final response = await http.put(
          Uri.parse('$baseUrl$endpoint'),
          headers: {
            'Authorization': 'Bearer $accessToken',
            'Content-Type': 'application/json',
          },
          body: json.encode(data),
        ).timeout(const Duration(seconds: 10));

        if (response.statusCode == 200) {
          print('✅ [Sync] $dataType synchronisé avec succès');
          
          if (context != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('✅ $dataType synchronisé'),
                backgroundColor: Colors.green,
                duration: const Duration(seconds: 2),
              ),
            );
          }
          
          return true;
        } else {
          throw Exception('Erreur ${response.statusCode}: ${response.body}');
        }

      } catch (e) {
        lastError = e as Exception;
        print('❌ [Sync] Tentative ${attempt + 1} échouée: $e');

        if (attempt < maxRetries) {
          print('⏳ [Sync] Nouvelle tentative dans ${retryDelay.inSeconds}s...');
          await Future.delayed(retryDelay);
          attempt++;
        } else {
          break;
        }
      }
    }

    // ❌ ÉCHEC DÉFINITIF après 3 tentatives
    print('❌ [Sync] Échec définitif après ${maxRetries + 1} tentatives');
    
    if (context != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('❌ Échec synchronisation $dataType\nVérifiez votre connexion'),
          backgroundColor: Colors.red,
          duration: const Duration(seconds: 5),
          action: SnackBarAction(
            label: 'Réessayer',
            textColor: Colors.white,
            onPressed: () {
              // Relancer manuellement
              _syncWithRetry(
                endpoint: endpoint,
                data: data,
                dataType: dataType,
                context: context,
              );
            },
          ),
        ),
      );
    }

    // Sauvegarder dans une file d'attente locale pour retry ultérieur
    await _addToSyncQueue(endpoint, data, dataType);

    return false;
  }

  /// 📝 Ajouter à la file d'attente de sync
  static Future<void> _addToSyncQueue(String endpoint, Map<String, dynamic> data, String dataType) async {
    if (!Hive.isBoxOpen('sync_queue')) {
      await Hive.openBox('sync_queue');
    }

    final box = Hive.box('sync_queue');
    final queueItem = {
      'endpoint': endpoint,
      'data': data,
      'dataType': dataType,
      'timestamp': DateTime.now().toIso8601String(),
      'retries': 0,
    };

    await box.add(queueItem);
    print('📝 [Sync] Ajouté à la file d\'attente: $dataType');
  }

  /// 🔄 Traiter la file d'attente au retour de connexion
  static Future<void> processSyncQueue({BuildContext? context}) async {
    if (!Hive.isBoxOpen('sync_queue')) {
      await Hive.openBox('sync_queue');
    }

    final box = Hive.box('sync_queue');

    if (box.isEmpty) {
      print('ℹ️ [Sync] File d\'attente vide');
      return;
    }

    print('🔄 [Sync] Traitement de ${box.length} éléments en attente...');

    final itemsToRemove = <dynamic>[];

    for (var i = 0; i < box.length; i++) {
      final item = box.getAt(i) as Map;

      final success = await _syncWithRetry(
        endpoint: item['endpoint'],
        data: Map<String, dynamic>.from(item['data']),
        dataType: item['dataType'],
        context: context,
      );

      if (success) {
        itemsToRemove.add(i);
      }
    }

    // Supprimer les éléments synchronisés
    for (var i in itemsToRemove.reversed) {
      await box.deleteAt(i);
    }

    if (context != null && itemsToRemove.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('✅ ${itemsToRemove.length} éléments synchronisés'),
          backgroundColor: Colors.green,
        ),
      );
    }
  }

  /// 🧹 Nettoyer les anciennes entrées (> 7 jours)
  static Future<void> cleanOldQueue() async {
    if (!Hive.isBoxOpen('sync_queue')) {
      await Hive.openBox('sync_queue');
    }

    final box = Hive.box('sync_queue');
    final cutoffDate = DateTime.now().subtract(const Duration(days: 7));
    final itemsToRemove = <dynamic>[];

    for (var i = 0; i < box.length; i++) {
      final item = box.getAt(i) as Map;
      final timestamp = DateTime.parse(item['timestamp']);

      if (timestamp.isBefore(cutoffDate)) {
        itemsToRemove.add(i);
      }
    }

    for (var i in itemsToRemove.reversed) {
      await box.deleteAt(i);
    }

    print('🧹 [Sync] ${itemsToRemove.length} anciens éléments supprimés');
  }
}
