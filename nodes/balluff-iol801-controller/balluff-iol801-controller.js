const iol801 = require("../../lib/iol801.js");
const { performance } = require("node:perf_hooks");

const monotonicClock = () => {
    return performance.now();
};

const isUint8ArrayEqual = ({ a, b }) => {
    if (a.length !== b.length) {
        return false;
    }

    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }

    return true;
}

const createSender = ({ resendIntervalMs, send }) => {

    let sendScheduledAt = undefined;
    let lastValue = undefined;

    let update = ({ value }) => {
        if (lastValue === undefined || !isUint8ArrayEqual({ a: value, b: lastValue })) {
            lastValue = value;
            sendScheduledAt = monotonicClock();
        }
    };

    const nextSendAt = () => {
        return sendScheduledAt;
    };

    const maybeSend = () => {
        const now = monotonicClock();

        if (now >= sendScheduledAt) {
            send({ value: lastValue });
            sendScheduledAt = now + resendIntervalMs;
        }
    };

    return {
        update,
        nextSendAt,
        maybeSend
    };
};

module.exports = function (RED) {
    function BalluffIol801Controller(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const hardwareType = config.hardware;
        if (!["Z036", "Z037"].includes(hardwareType)) {
            node.error("invalid hardware type");
            return;
        }

        const resendIntervalMs = parseInt(config.interval);
        if (isNaN(resendIntervalMs)) {
            node.error("invalid resend interval");
            return;
        }

        const acyclicResendIntervalMs = parseInt(config.acyclicinterval);
        if (isNaN(acyclicResendIntervalMs)) {
            node.error("invalid acyclic resend interval");
            return;
        }

        const processDataSender = createSender({
            resendIntervalMs: resendIntervalMs,
            send: ({ value }) => {
                node.send([
                    { payload: value },
                    null
                ]);
            }
        });

        let acyclicDataSenders = {};

        let activeSmartlightConfig = undefined;
        let lastError = undefined;

        const updateStatusIcon = () => {
            if (lastError !== undefined) {
                node.status({ fill: "red", shape: "ring", text: "error" });
                return;
            }

            if (activeSmartlightConfig !== undefined) {
                node.status({ fill: "green", shape: "dot", text: "controlling" });
                return;
            }

            node.status({ fill: "gray", shape: "dot", text: "waiting" });
        };

        updateStatusIcon();

        let nextSendTimeoutHandle = undefined;

        const maybeSendNext = () => {

            if (activeSmartlightConfig === undefined) {
                return;
            }

            const smartlightConfig = activeSmartlightConfig;

            processDataSender.update({ value: smartlightConfig.processData });
            smartlightConfig.acyclicData.forEach((req) => {
                const key = `${req.index}-${req.subIndex}`;

                if (acyclicDataSenders[key] === undefined) {
                    acyclicDataSenders = {
                        ...acyclicDataSenders,
                        [key]: createSender({
                            resendIntervalMs: acyclicResendIntervalMs,
                            send: ({ value }) => {
                                node.send([
                                    null,
                                    {
                                        index: req.index,
                                        subIndex: req.subIndex,
                                        payload: value
                                    }
                                ]);
                            }
                        })
                    };
                }

                const acyclicSender = acyclicDataSenders[key];
                acyclicSender.update({ value: req.payload });
            });

            processDataSender.maybeSend();
            let nextSendAt = processDataSender.nextSendAt();

            smartlightConfig.acyclicData.forEach((req) => {
                const key = `${req.index}-${req.subIndex}`;

                const acyclicDataSender = acyclicDataSenders[key];
                acyclicDataSender.maybeSend();

                const next = acyclicDataSender.nextSendAt();
                if (next < nextSendAt) {
                    nextSendAt = next;
                }
            });

            const now = monotonicClock();
            // add 5ms to ensure we don't miss the next send
            const waitTimeMs = Math.max(nextSendAt - now + 5, 0);

            clearTimeout(nextSendTimeoutHandle);
            nextSendTimeoutHandle = setTimeout(() => {
                maybeSendNext();
            }, waitTimeMs);
        };

        node.on("input", (inputMessage) => {

            let smartlightConfig = undefined;
            let error = undefined;

            try {
                smartlightConfig = iol801.hardware({ version: hardwareType }).segmentMode().configFor(inputMessage.payload);
            } catch (ex) {
                error = ex;
            }

            lastError = error;
            activeSmartlightConfig = smartlightConfig;

            if (error) {
                node.error(error, error);
            }

            maybeSendNext();

            updateStatusIcon();
        });

        node.on("close", () => {
            clearTimeout(nextSendTimeoutHandle);
            nextSendTimeoutHandle = undefined;
        });
    }

    RED.nodes.registerType("balluff-iol801-controller", BalluffIol801Controller);
}
