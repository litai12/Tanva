type LocalToolSelectionRequest = {
  userInput?: string;
  prompt?: string;
  availableTools?: string[];
};

type LocalToolSelectionResponse = {
  success: true;
  data: {
    selectedTool: string;
    parameters: { prompt: string };
    confidence: 1;
    reasoning: string;
  };
};

export const resolveLocalSingleToolSelection = (
  request: LocalToolSelectionRequest,
): LocalToolSelectionResponse | null => {
  const availableTools = Array.from(
    new Set((request.availableTools || []).filter(Boolean)),
  );
  if (availableTools.length !== 1) return null;

  return {
    success: true,
    data: {
      selectedTool: availableTools[0],
      parameters: {
        prompt: request.userInput || request.prompt || "",
      },
      confidence: 1,
      reasoning: "Only one tool is available; selected locally",
    },
  };
};
