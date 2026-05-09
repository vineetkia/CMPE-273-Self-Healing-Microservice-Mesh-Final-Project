import { useState, useCallback } from "react";
import { exerciseFlow } from "../api/commands";

export function useFlowExerciser() {
  const [lastResponses, setLastResponses] = useState({});

  const exercise = useCallback(async (flowId, body) => {
    const r = await exerciseFlow(flowId, body);
    setLastResponses(prev => ({ ...prev, [flowId]: r }));
    return r;
  }, []);

  return { lastResponses, exercise };
}
