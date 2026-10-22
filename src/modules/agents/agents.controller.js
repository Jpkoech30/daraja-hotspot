const agentsService = require('./agents.service');

exports.poll = async (req, res, next) => {
  try {
    const routerId = req.router.id;
    
    // req.body will be a string if the MikroTik sends text/plain
    const bodyText = typeof req.body === 'string' ? req.body : '';

    const responseText = await agentsService.processPoll(routerId, bodyText);

    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(responseText);

  } catch (error) {
    console.error('Agent Poll Error:', error);
    res.status(500).send('ERROR');
  }
};