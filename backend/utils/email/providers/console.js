async function send({ to, from, subject }) {
  console.log(`Email console provider: to ${to} from ${from} subject ${subject}`);
  return { provider: 'console' };
}

module.exports = { send };
