// handler.js

const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");

// Initialize the AWS Lambda client. It will automatically use the region from the environment.
const lambdaClient = new LambdaClient({});

// These are used to construct the full, deployed name of the functions to invoke.
const SERVICE_NAME = "optifuse-ecommerce-test";
const STAGE = process.env.STAGE || "dev";

/**
 * A helper function to invoke another Lambda function asynchronously.
 * @param {string} functionName - The short name of the function from serverless.yml.
 * @param {object} payload - The data to pass to the next function.
 */
const invokeNext = async (functionName, payload) => {
  const fullFunctionName = `${SERVICE_NAME}-${STAGE}-${functionName}`;
  
  const command = new InvokeCommand({
    FunctionName: fullFunctionName,
    // 'Event' invocation is asynchronous ("fire and forget").
    // X-Ray will still trace the connection between the functions.
    InvocationType: 'Event', 
    Payload: JSON.stringify(payload),
  });
  
  console.log(`Invoking: ${fullFunctionName}`);
  return lambdaClient.send(command);
};

// --- Function Handlers ---

// 1. API Entry Point
module.exports.orderPlaced = async (event) => {
  console.log("Order received. Starting parallel workflows.");
  const orderData = { orderId: `order-${Date.now()}`, customerId: "ABC-XYZ" };

  // Fan-out: Start two independent workflows in parallel.
  await Promise.all([
    invokeNext('processPayment', orderData),
    invokeNext('updateInventory', orderData) // This kicks off the fulfillment chain.
  ]);

  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Order workflow initiated successfully.", orderId: orderData.orderId }),
  };
};

// 2a. A separate, short-lived task.
module.exports.processPayment = async (event) => {
  console.log(`[${event.orderId}] Processing payment...`);
  // This workflow branch ends here.
  return { ...event, paymentStatus: "SUCCESS" };
};

// 2b. The start of the fulfillment chain.
module.exports.updateInventory = async (event) => {
  console.log(`[${event.orderId}] Updating inventory...`);
  // This function invokes the next in the chain.
  await invokeNext('prepareShipping', { ...event, inventoryStatus: "UPDATED" });
  return { ...event, inventoryStatus: "UPDATED" };
};

module.exports.prepareShipping = async (event) => {
  console.log(`[${event.orderId}] Preparing shipping label...`);
  await invokeNext('notifyCustomer', { ...event, shippingStatus: "LABEL_CREATED" });
  return { ...event, shippingStatus: "LABEL_CREATED" };
};

module.exports.notifyCustomer = async (event) => {
  console.log(`[${event.orderId}] Sending notification to customer...`);
  await invokeNext('logCompletion', { ...event, notificationStatus: "SENT" });
  return { ...event, notificationStatus: "SENT" };
};

module.exports.logCompletion = async (event) => {
  console.log(`[${event.orderId}] Workflow is complete. Logging final status.`);
  return { ...event, finalStatus: "COMPLETE" };
};