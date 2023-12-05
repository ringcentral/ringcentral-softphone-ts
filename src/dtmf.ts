// The key is the DTMF RTP payload Buffer convert to integer by `.readIntBE(0, 4)`
export const dtmfMapping = {
  393216: 0,
  17170432: 1,
  33947648: 2,
  50724864: 3,
  67502080: 4,
  84279296: 5,
  101056512: 6,
  117833728: 7,
  134610944: 8,
  151388160: 9,
  168165376: '*',
  184942592: '#',
};
