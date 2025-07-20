const axios = require('axios');

fonction keepAlivePing() {
  setInterval(async() => {
    essayer {
      const response = await axios.get(' http://localhost: 3000/health' ); // adapte le port si nécessaire
      console.log('Ping réussi :', response.status);
    } catch (erreur) {
      console.error('Ping échoué :', error.message);
    }
  }, 5 * 60 * 1000); // toutes les 5 minutes
}

module.exports = keepAlivePing;
