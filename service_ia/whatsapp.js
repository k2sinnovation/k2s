async function checkWhatsApp24hWindow(userId, contactPhone) {
  const lastMessage = await Message.findOne({
    where: {
      userId,
      platform: 'whatsapp',
      contact_id: contactPhone
    },
    order: [['received_at', 'DESC']]
  });
  
  if (!lastMessage) return true;
  
  const hoursSinceLastMessage = 
    (Date.now() - lastMessage.received_at) / (1000 * 60 * 60);
  
  return hoursSinceLastMessage < 24;
}
