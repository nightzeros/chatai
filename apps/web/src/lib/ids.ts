import { nanoid } from "nanoid";

export function createId() {
  return nanoid();
}

export function createAssistantPublicId() {
  return `asst_${nanoid(10)}`;
}
