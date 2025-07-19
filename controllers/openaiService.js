import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;

class ApiService {
  static const String baseUrl = 'https://k2s.onrender.com/api';

  static String? lastResume;

  // Étape 1 : Appel à /analyze pour obtenir résumé + 5 questions
  static Future<List<String>> getAIQuestions(String texte) async {
    final url = Uri.parse('$baseUrl/analyze');
    final response = await http.post(
      url,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'text': texte,
        'user_id': 'test_user',
      }),
    );

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);

      if (data.containsKey('resume') && data.containsKey('questions')) {
        lastResume = data['resume'];

        final questionsRaw = data['questions'];

        if (questionsRaw is List) {
          return questionsRaw.map((q) => q.toString()).toList();
        } else if (questionsRaw is String) {
          throw Exception('Erreur IA : $questionsRaw');
        } else {
          throw Exception('Format inattendu reçu depuis le backend');
        }
      } else {
        throw Exception('Réponse inattendue : les clés "resume" ou "questions" sont absentes');
      }
    } else {
      throw Exception('Erreur lors de la récupération des questions : ${response.statusCode}');
    }
  }

  // Étape 2 : Envoyer les réponses utilisateur à /answer
  static Future<String> sendAnswersToAI(String texte, Map<String, String> answers) async {
    final url = Uri.parse('$baseUrl/answer');
    final response = await http.post(
      url,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'resume': texte,
        'reponses': answers,
      }),
    );

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      return data['reponse'] ?? 'Aucune réponse reçue.';
    } else {
      throw Exception('Erreur lors de l’envoi des réponses : ${response.statusCode}');
    }
  }

  // Étape 3 : Analyse finale avec fichiers (optionnel)
  static Future<String> analyzeWithAI({
    required String resume,
    required List<File> fichiers,
  }) async {
    final uri = Uri.parse('$baseUrl/analyze');
    final request = http.MultipartRequest('POST', uri)
      ..fields['resume'] = resume;

    for (var fichier in fichiers) {
      final fileStream = await http.MultipartFile.fromPath('fichiers', fichier.path);
      request.files.add(fileStream);
    }

    final response = await request.send();

    if (response.statusCode == 200) {
      final respBody = await response.stream.bytesToString();
      final decoded = jsonDecode(respBody);
      return decoded['iaResponse'] ?? 'Réponse IA vide.';
    } else {
      throw Exception('Erreur backend : ${response.statusCode}');
    }
  }

  // Étape 4 : Génération future de questions IA supplémentaires (non utilisée maintenant)
  static Future<List<String>> fetchQuestionsWithAI({
    required String resume,
    required List<Map<String, String>> conversation,
    required List<String> fichiers,
  }) async {
    final url = Uri.parse('$baseUrl/answer');
    final response = await http.post(
      url,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'resume': resume,
        'conversation': conversation,
        'fichiers': fichiers,
      }),
    );

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      return List<String>.from(data['questions'] ?? []);
    } else {
      throw Exception('Erreur lors de la génération des questions : ${response.body}');
    }
  }
}
