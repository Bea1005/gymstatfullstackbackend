const User = require('../../src/models/User');
const ScreenerIdSequence = require('../../src/models/ScreenerIdSequence');
const {
  allocateNextScreenerId,
  getNextScreenerId,
  MAX_SCREENER_SEQUENCE
} = require('../../src/utils/screenerId');

jest.mock('../../src/models/User', () => ({
  find: jest.fn()
}));
jest.mock('../../src/models/ScreenerIdSequence', () => ({
  findById: jest.fn(),
  updateOne: jest.fn(),
  findOneAndUpdate: jest.fn()
}));

const makeQuery = (result) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(result)
});

describe('Screener ID sequence', () => {
  const year = String(new Date().getFullYear());

  beforeEach(() => {
    jest.clearAllMocks();
    User.find.mockReturnValue(makeQuery([]));
    ScreenerIdSequence.findById.mockReturnValue(makeQuery(null));
    ScreenerIdSequence.updateOne.mockResolvedValue({});
    ScreenerIdSequence.findOneAndUpdate.mockResolvedValue({ value: 1 });
  });

  it('uses the current year and hexadecimal progression', async () => {
    let value = 8;
    ScreenerIdSequence.findById.mockImplementation(() => makeQuery({ value }));
    ScreenerIdSequence.findOneAndUpdate.mockImplementation((_filter, update) => {
      value += update.$inc.value;
      return Promise.resolve({ value });
    });

    await expect(allocateNextScreenerId()).resolves.toBe(`S${year}-0009`);
    await expect(allocateNextScreenerId()).resolves.toBe(`S${year}-000A`);
  });

  it('seeds a new yearly sequence above existing IDs without changing them', async () => {
    let value;
    ScreenerIdSequence.findById.mockImplementation(() => makeQuery(
      value === undefined ? null : { value }
    ));
    User.find.mockReturnValue(makeQuery([
      { id: `S${year}-0009` },
      { id: `S${year}-0002` },
      { id: 'S000123' }
    ]));
    ScreenerIdSequence.updateOne.mockImplementation((_filter, update) => {
      if (value === undefined) value = update.$setOnInsert.value;
      return Promise.resolve({});
    });
    ScreenerIdSequence.findOneAndUpdate.mockImplementation((_filter, update) => {
      value += update.$inc.value;
      return Promise.resolve({ value });
    });

    await expect(allocateNextScreenerId()).resolves.toBe(`S${year}-000A`);
    expect(User.find).toHaveBeenCalledWith({
      role: 'screener',
      id: { $regex: new RegExp(`^S${year}-[0-9A-F]{4}$`, 'i') }
    });
  });

  it('allocates distinct IDs for simultaneous requests through atomic increments', async () => {
    let value;
    ScreenerIdSequence.findById.mockImplementation(() => makeQuery(
      value === undefined ? null : { value }
    ));
    ScreenerIdSequence.updateOne.mockImplementation((_filter, update) => {
      if (value === undefined) value = update.$setOnInsert.value;
      return Promise.resolve({});
    });
    ScreenerIdSequence.findOneAndUpdate.mockImplementation((filter, update) => {
      if (value >= MAX_SCREENER_SEQUENCE || value >= filter.value.$lt) {
        return Promise.resolve(null);
      }
      value += update.$inc.value;
      return Promise.resolve({ value });
    });

    const ids = await Promise.all([
      allocateNextScreenerId(),
      allocateNextScreenerId()
    ]);

    expect(ids).toEqual([`S${year}-0001`, `S${year}-0002`]);
    expect(new Set(ids).size).toBe(2);
    expect(ScreenerIdSequence.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: year, value: { $lt: MAX_SCREENER_SEQUENCE } },
      { $inc: { value: 1 } },
      { new: true }
    );
  });

  it('does not allocate beyond FFFF', async () => {
    ScreenerIdSequence.findById.mockReturnValue(makeQuery({ value: MAX_SCREENER_SEQUENCE }));
    ScreenerIdSequence.findOneAndUpdate.mockResolvedValue(null);

    await expect(allocateNextScreenerId()).rejects.toMatchObject({
      code: 'SCREENER_ID_SEQUENCE_EXHAUSTED'
    });
    await expect(getNextScreenerId()).rejects.toMatchObject({
      code: 'SCREENER_ID_SEQUENCE_EXHAUSTED'
    });
  });
});
