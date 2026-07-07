process.env.FORCE_MOCK = "true";
process.env.COMMUNICATION_PROVIDER = "mock";
process.env.ADMIN_SEED_PASSWORD = "test-secure-password-not-admin123";

const config = require("../src/services/communication/config");
const OtpService = require("../src/services/communication/services/OtpService");
const TemplateService = require("../src/services/communication/services/TemplateService");
const LogService = require("../src/services/communication/services/LogService");
const QueueService = require("../src/services/communication/services/QueueService");
const MockProvider = require("../src/services/communication/providers/mock/MockProvider");

beforeEach(() => {
  LogService.clearLogs();
  OtpService.cleanupExpired();
  jest.clearAllMocks();
});

describe("Communication Config", () => {
  test("defaults to mock provider", () => {
    expect(config.provider).toBe("mock");
  });

  test("otp config has defaults", () => {
    expect(config.otp.length).toBeGreaterThanOrEqual(4);
    expect(config.otp.expiryMinutes).toBeGreaterThan(0);
    expect(config.otp.maxAttempts).toBeGreaterThan(0);
  });
});

describe("OTP Service", () => {
  test("generateOtp returns a numeric string of configured length", async () => {
    const otp = await OtpService.generateOtp("test@example.com");
    expect(otp).toMatch(/^\d{6}$/);
  });

  test("verifyOtp returns valid for correct OTP", async () => {
    const identifier = "user@test.com";
    const otp = await OtpService.generateOtp(identifier);
    const result = await OtpService.verifyOtp(identifier, otp);
    expect(result.valid).toBe(true);
    expect(result.reason).toContain("verified");
  });

  test("verifyOtp rejects incorrect OTP", async () => {
    const identifier = "user@test.com";
    await OtpService.generateOtp(identifier);
    const result = await OtpService.verifyOtp(identifier, "000000");
    expect(result.valid).toBe(false);
  });

  test("verifyOtp rejects reused OTP (record deleted after use)", async () => {
    const identifier = "user@test.com";
    const otp = await OtpService.generateOtp(identifier);
    await OtpService.verifyOtp(identifier, otp);
    const result = await OtpService.verifyOtp(identifier, otp);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("No OTP requested");
  });

  test("verifyOtp blocks after max attempts", async () => {
    const identifier = "user@test.com";
    await OtpService.generateOtp(identifier);
    for (let i = 0; i < config.otp.maxAttempts; i++) {
      await OtpService.verifyOtp(identifier, "000000");
    }
    const result = await OtpService.verifyOtp(identifier, "000000");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("attempt");
  });

  test("getOtpStatus returns active status", async () => {
    const identifier = "user@test.com";
    await OtpService.generateOtp(identifier);
    const status = OtpService.getOtpStatus(identifier);
    expect(status.active).toBe(true);
    expect(status.attemptsRemaining).toBe(config.otp.maxAttempts);
  });

  test("invalidateOtp removes OTP", async () => {
    const identifier = "user@test.com";
    await OtpService.generateOtp(identifier);
    OtpService.invalidateOtp(identifier);
    const status = OtpService.getOtpStatus(identifier);
    expect(status.active).toBe(false);
  });

  test("maskIdentifier masks emails", () => {
    expect(OtpService.maskIdentifier("test@example.com")).toBe("t***@example.com");
  });

  test("maskIdentifier masks phone numbers", () => {
    expect(OtpService.maskIdentifier("9876543210")).toBe("98****3210");
  });
});

describe("Template Service", () => {
  test("renders SMS template with variables", () => {
    const result = TemplateService.render("sms", "order_confirmation", {
      orderId: "123",
      amount: "500",
    });
    expect(result).not.toBeNull();
    expect(result.message).toContain("123");
    expect(result.message).toContain("500");
  });

  test("renders WhatsApp template", () => {
    const result = TemplateService.render("whatsapp", "delivered", {
      orderId: "456",
    });
    expect(result).not.toBeNull();
    expect(result.message).toContain("456");
  });

  test("renders email template with subject and body", () => {
    const result = TemplateService.render("email", "otp_login", {
      otp: "123456",
      expiryMinutes: "5",
    });
    expect(result).not.toBeNull();
    expect(result.subject).toContain("OTP");
    expect(result.body).toContain("123456");
  });

  test("returns null for unknown template", () => {
    const result = TemplateService.render("sms", "nonexistent");
    expect(result).toBeNull();
  });

  test("returns null for unknown channel", () => {
    const result = TemplateService.render("fax", "test");
    expect(result).toBeNull();
  });

  test("getAllTemplates returns all channels", () => {
    const templates = TemplateService.getAllTemplates();
    expect(templates).toHaveProperty("sms");
    expect(templates).toHaveProperty("whatsapp");
    expect(templates).toHaveProperty("email");
  });
});

describe("Log Service", () => {
  test("createLog returns a message ID", () => {
    const id = LogService.createLog({
      recipient: "+919876543210",
      channel: "sms",
      type: "test",
      provider: "mock",
    });
    expect(id).toBeTruthy();
    expect(id.startsWith("msg_")).toBe(true);
  });

  test("getLog returns message details", () => {
    const id = LogService.createLog({
      recipient: "+919876543210",
      channel: "sms",
      type: "test",
      provider: "mock",
    });
    const log = LogService.getLog(id);
    expect(log).not.toBeNull();
    expect(log.channel).toBe("sms");
    expect(log.status).toBe("queued");
  });

  test("updateStatus modifies log status", () => {
    const id = LogService.createLog({
      recipient: "+919876543210", channel: "sms", type: "test", provider: "mock",
    });
    LogService.markSent(id);
    const log = LogService.getLog(id);
    expect(log.status).toBe("sent");
    expect(log.sentAt).toBeTruthy();
  });

  test("markFailed records error", () => {
    const id = LogService.createLog({
      recipient: "+919876543210", channel: "sms", type: "test", provider: "mock",
    });
    LogService.markFailed(id, "Connection timeout");
    const log = LogService.getLog(id);
    expect(log.status).toBe("failed");
    expect(log.error).toContain("timeout");
  });

  test("getAllLogs filters by channel", () => {
    LogService.createLog({ recipient: "a@b.com", channel: "email", type: "test", provider: "mock" });
    LogService.createLog({ recipient: "+911234567890", channel: "sms", type: "test", provider: "mock" });
    const emails = LogService.getAllLogs({ channel: "email" });
    expect(emails).toHaveLength(1);
    expect(emails[0].channel).toBe("email");
  });

  test("getAllLogs filters by status", () => {
    const id = LogService.createLog({ recipient: "+911234567890", channel: "sms", type: "test", provider: "mock" });
    LogService.markFailed(id, "error");
    const failed = LogService.getAllLogs({ status: "failed" });
    expect(failed.length).toBeGreaterThanOrEqual(1);
  });

  test("getStats returns summary", () => {
    LogService.createLog({ recipient: "+911234567890", channel: "sms", type: "test", provider: "mock" });
    const stats = LogService.getStats();
    expect(stats).toHaveProperty("total");
    expect(stats).toHaveProperty("byChannel");
    expect(stats.byChannel).toHaveProperty("sms");
  });

  test("maskRecipient masks email", () => {
    expect(LogService.maskRecipient("john@example.com")).toBe("j***@example.com");
  });

  test("maskRecipient masks phone", () => {
    const masked = LogService.maskRecipient("9876543210");
    expect(masked).toBe("98****3210");
  });
});

describe("Queue Service", () => {
  test("enqueue adds a job", () => {
    const id = QueueService.enqueue("test_job", { msg: "hello" });
    expect(id).toBeTruthy();
    expect(id.startsWith("comm_job_")).toBe(true);
  });

  test("getJob returns job details", () => {
    const id = QueueService.enqueue("test_job", { msg: "hello" });
    const job = QueueService.getJob(id);
    expect(job).not.toBeNull();
    expect(job.data.msg).toBe("hello");
    expect(job.status).toBe("queued");
  });

  test("processJob executes handler", (done) => {
    QueueService.processJob("test_handler", async (job) => {
      expect(job.data.msg).toBe("handler_test");
      done();
    });
    QueueService.enqueue("test_handler", { msg: "handler_test" });
  });

  test("retryFailedJobs returns a count", () => {
    QueueService.enqueue("retry_test", { msg: "retry" });
    const count = QueueService.retryFailedJobs();
    expect(typeof count).toBe("number");
  });

  test("retryJob returns false for missing job", () => {
    const result = QueueService.retryJob("nonexistent");
    expect(result).toBe(false);
  });

  test("getStats returns status counts", () => {
    QueueService.enqueue("stats_test", {});
    const stats = QueueService.getStats();
    expect(stats).toHaveProperty("total");
    expect(stats).toHaveProperty("queued");
    expect(stats.total).toBeGreaterThanOrEqual(1);
  });
});

describe("Mock Provider", () => {
  let provider;

  beforeAll(() => {
    provider = new MockProvider();
  });

  test("sendSms returns success", async () => {
    const result = await provider.sendSms({ recipient: "+919876543210", message: "Test SMS" });
    expect(result.success).toBe(true);
    expect(result.mock).toBe(true);
    expect(result.provider).toBe("mock");
  });

  test("sendSms with template renders correctly", async () => {
    const result = await provider.sendSms({
      recipient: "+919876543210",
      template: "order_confirmation",
      templateVars: { orderId: "123", amount: "500" },
    });
    expect(result.success).toBe(true);
  });

  test("sendOtp returns success", async () => {
    const result = await provider.sendOtp({ recipient: "+919876543210" });
    expect(result.success).toBe(true);
    expect(result.mock).toBe(true);
  });

  test("verifyOtp validates correctly", async () => {
    const identifier = "verify@test.com";
    await provider.sendOtp({ recipient: identifier, channel: "email" });
    const otp = await OtpService.getDevOtp(identifier);
    const result = await provider.verifyOtp({ recipient: identifier, otp: "000000" });
    expect(result.valid).toBe(false);
  });

  test("sendWhatsApp returns success", async () => {
    const result = await provider.sendWhatsApp({ recipient: "+919876543210", message: "Test WhatsApp" });
    expect(result.success).toBe(true);
    expect(result.mock).toBe(true);
  });

  test("sendEmail returns success", async () => {
    const result = await provider.sendEmail({
      recipient: "test@example.com",
      subject: "Test",
      body: "Test body",
    });
    expect(result.success).toBe(true);
    expect(result.mock).toBe(true);
  });

  test("sendEmail with template", async () => {
    const result = await provider.sendEmail({
      recipient: "test@example.com",
      template: "order_confirmation",
      templateVars: { orderId: "123", amount: "500" },
    });
    expect(result.success).toBe(true);
  });

  test("getDeliveryStatus returns status", async () => {
    const result = await provider.sendSms({ recipient: "+919876543210", message: "Status test" });
    const status = await provider.getDeliveryStatus({ messageId: result.logId });
    expect(status).toHaveProperty("status");
  });

  test("healthCheck returns healthy", async () => {
    const health = await provider.healthCheck();
    expect(health.status).toBe("healthy");
    expect(health.provider).toBe("mock");
  });
});
