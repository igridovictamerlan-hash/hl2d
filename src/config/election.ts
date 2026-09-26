/**
 * Выборы Администратора после его гибели (systems/ElectionSystem.ts): сколько кандидатов (самые
 * лояльные, не ниже minLoyalty — уровень «Лоялист»), сколько длятся, с какой частотой голосуют NPC
 * (доля в секунду: за duration почти все успевают).
 */
export const ELECTION = {
  candidates: 3,
  minLoyalty: 40,
  duration: 60,
  npcVoteRate: 0.06,
} as const;
