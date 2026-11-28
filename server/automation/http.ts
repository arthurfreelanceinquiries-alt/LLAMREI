import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../lib/http.ts';
import { approveMissionStep, cancelMission, getAutomationSnapshot, getMission, runSavedRule } from './missions.ts';
import { previewAutomation, saveAutomationRule } from './rules.ts';

export async function routeAutomation(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = req.method;
  if (pathname === '/api/automation' && method === 'GET') {
    sendJson(res, 200, getAutomationSnapshot());
    return true;
  }
  if (pathname === '/api/automation/rules' && method === 'POST') {
    sendJson(res, 201, saveAutomationRule(await readJsonBody<unknown>(req)));
    return true;
  }
  if (pathname === '/api/automation/rules/preview' && method === 'POST') {
    sendJson(res, 200, previewAutomation(await readJsonBody<unknown>(req)));
    return true;
  }
  const rule = pathname.match(/^\/api\/automation\/rules\/([a-f0-9-]+)(\/run)?$/i);
  if (rule && !rule[2] && method === 'PATCH') {
    sendJson(res, 200, saveAutomationRule(await readJsonBody<unknown>(req), rule[1]));
    return true;
  }
  if (rule?.[2] && method === 'POST') {
    sendJson(res, 201, runSavedRule(rule[1], await readJsonBody<unknown>(req)));
    return true;
  }
  const mission = pathname.match(/^\/api\/automation\/missions\/([a-f0-9-]+)(?:\/(approve|cancel))?$/i);
  if (!mission) return false;
  if (method === 'GET' && !mission[2]) sendJson(res, 200, getMission(mission[1]));
  else if (method === 'POST' && mission[2] === 'approve') sendJson(res, 200, approveMissionStep(mission[1], await readJsonBody<unknown>(req)));
  else if (method === 'POST' && mission[2] === 'cancel') sendJson(res, 200, cancelMission(mission[1]));
  else return false;
  return true;
}
