import { MessageChannel, Worker, receiveMessageOnPort } from "node:worker_threads";

const { port1, port2 } = new MessageChannel();
const w = new Worker(
  `const { workerData } = require("node:worker_threads");
   workerData.port.postMessage("reason-text");
   workerData.port.close();`,
  { eval: true, workerData: { port: port2 }, transferList: [port2] },
);
w.on("exit", () => {
  setTimeout(() => {
    console.log("after-close message:", JSON.stringify(receiveMessageOnPort(port1)));
  }, 50);
});
