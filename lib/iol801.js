const buzzerModeToType = {
    "off": 0x00,
    "on": 0x00,
    "1hz": 0x01,
    "5hz": 0x02,
    "3tones2sec": 0x03
};

const buzzerModeToState = {
    "off": 0x00,
    "on": 0x01,
    "1hz": 0x01,
    "5hz": 0x01,
    "3tones2sec": 0x01
};

const colorToBits = {
    "off": 0x00,
    "green": 0x01,
    "red": 0x02,
    "yellow": 0x03,
    "blue": 0x04,
    "orange": 0x05,
    "white": 0x07
};

const blinkByOption = {
    "off": 0,
    "on": 1,
    "flash": 1
};

const flashByOption = {
    "off": 0,
    "on": 0,
    "flash": 1
};

// const configTemplate = {
//     buzzer: {
//         mode: "off",
//         volume: 128
//     },

//     blinkSpeed: 1,

//     segments: [
//         {
//             blink: "off",
//             color: "off",
//         },
//         {
//             blink: "on",
//             color: "green",
//         },
//         {
//             blink: "flash",
//             color: "red",
//         }
//     ]
// };

const MODE_SEGMENT = 0x00;

const supportedHardwareVersions = ["Z036", "Z037"];

const hardware = ({ version = "Z036" }) => {

    if (!supportedHardwareVersions.includes(version)) {
        throw Error("unsupported hardware version");
    }

    const segmentMode = () => {

        const parseSegment = ({ segment }) => {
            const blink = blinkByOption[segment.blink];
            const flash = flashByOption[segment.blink];

            if (blink === undefined || flash === undefined) {
                throw Error("invalid blink option");
            }

            const colorBits = colorToBits[segment.color];
            if (colorBits === undefined) {
                throw Error("invalid color option");
            }

            return {
                blink,
                flash,
                colorBits
            };
        };

        const segmentFallback = {
            blink: "off",
            color: "off"
        };

        const configFor = ({
            buzzer,
            blinkSpeed,
            segments
        }) => {

            if (version === "Z036" && buzzer.mode === "on") {
                throw Error("Z036 has no buzzer");
            }

            if (![1, 2, 3, 4, 5].includes(blinkSpeed)) {
                throw Error("expected blink speed to be 1, 2, 3, 4 or 5");
            }

            const buzzerMode = buzzer?.mode || "off";

            const buzzerState = buzzerModeToState[buzzerMode];
            const buzzerType = buzzerModeToType[buzzerMode];
            if (buzzerState === undefined || buzzerType === undefined) {
                throw Error("invalid buzzer option");
            }

            if (segments.length < 1 || segments.length > 3) {
                throw Error("expected 1-3 segments");
            }

            const { blink: blink1, flash: flash1, colorBits: colorBits1 } = parseSegment({ segment: segments.length >= 1 ? segments[0] : segmentFallback });
            const { blink: blink2, flash: flash2, colorBits: colorBits2 } = parseSegment({ segment: segments.length >= 2 ? segments[1] : segmentFallback });
            const { blink: blink3, flash: flash3, colorBits: colorBits3 } = parseSegment({ segment: segments.length >= 3 ? segments[2] : segmentFallback });

            const processData = new Uint8Array(version === "Z036" ? 2 : 3);

            processData[0] = (blink2 << 7) | (colorBits2 << 4) | (blink1 << 3) | (colorBits1 << 0);
            processData[1] = (blink3 << 3) | (colorBits3 << 0);

            if (version === "Z036") {
                processData[2] = buzzerState << 7;
            }

            let acyclicData = [
                // mode, 0x00 -> segment mode
                {
                    index: 0x40,
                    subIndex: 0,
                    payload: new Uint8Array([MODE_SEGMENT])
                },

                // segment count
                {
                    index: 0x41,
                    subIndex: 0,
                    payload: new Uint8Array([segments.length])
                },

                // blink speed (1 slowest - 5 fastest)
                {
                    index: 0x52,
                    subIndex: 0,
                    payload: new Uint8Array([blinkSpeed])
                },

                // blink mode (blink or flash)
                {
                    index: 0x53,
                    subIndex: 0,
                    payload: new Uint8Array([
                        (flash3 << 2) | (flash2 << 1) | (flash1 << 0)
                    ])
                }
            ];

            if (version === "Z037") {

                if (buzzer.volume === undefined || isNaN(buzzer.volume)) {
                    throw Error("invalid buzzer volume");
                }

                if (buzzer.volume < 0 || buzzer.volume > 255) {
                    throw Error("expected volume to be 0-255");
                }

                // acyclicData = [
                //     ...acyclicData,
                //     {
                //         index: 0xFE,
                //         subIndex: 1,
                //         payload: new Uint8Array([buzzerType])
                //     },

                //     {
                //         index: 0xFE,
                //         subIndex: 2,
                //         payload: new Uint8Array([buzzer.volume])
                //     }
                // ];
            }

            return {
                processData,
                acyclicData
            };
        };

        return {
            configFor
        };
    };

    return {
        segmentMode
    };
};

module.exports = {
    hardware,
};
