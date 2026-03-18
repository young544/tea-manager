import { GoogleGenAI } from "@google/genai";
import { HarvestEntry } from "../types";

export const getAIInsights = async (entries: HarvestEntry[]) => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  const dataSummary = entries.map(e => ({
    worker: e.workerName,
    kg: e.totalKg,
    bags: e.bags.length,
    date: e.date
  }));

  const prompt = `
    You are an expert agricultural consultant for a tea farm. 
    Analyze the following harvest data and provide 3-4 concise, actionable insights or observations.
    Focus on productivity, trends, and suggestions for the farm manager.
    Keep the tone professional and encouraging.
    
    Data: ${JSON.stringify(dataSummary)}
    
    Format the response as a simple list of bullet points.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("AI Insights Error:", error);
    return "Could not generate insights at this time. Please check your connection and try again.";
  }
};

export const getWorkerPerformanceInsights = async (entries: HarvestEntry[]) => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  // Group data by worker
  const workerStats: Record<string, { totalKg: number, totalBags: number, daysWorked: number }> = {};
  
  entries.forEach(e => {
    if (!workerStats[e.workerName]) {
      workerStats[e.workerName] = { totalKg: 0, totalBags: 0, daysWorked: 0 };
    }
    workerStats[e.workerName].totalKg += e.totalKg;
    workerStats[e.workerName].totalBags += e.bags.length;
    workerStats[e.workerName].daysWorked += 1; // Simplification: each entry is a day
  });

  const prompt = `
    You are an expert agricultural HR consultant. 
    Analyze the following worker performance data from a tea farm over the last week.
    Identify:
    1. Top Performers (highest total Kg or consistency).
    2. Workers who may need additional support or training (lower productivity compared to peers).
    3. General advice for team motivation.
    
    Data: ${JSON.stringify(workerStats)}
    
    Format the response with clear headings: "Top Performers", "Support Needed", and "Recommendations".
    Keep it professional, constructive, and concise.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("Worker Performance AI Error:", error);
    return "Could not generate worker analysis at this time.";
  }
};
