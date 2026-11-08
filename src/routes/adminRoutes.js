const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const User = require('../models/User');
const StudentAthlete = require('../models/StudentAthlete');
const Equipment = require('../models/Equipment');
const Borrowing = require('../models/Borrowing');
const ScheduleRequest = require('../models/ScheduleRequest');
const Schedule = require('../models/Schedule');
const { protect, authorize } = require('../middleware/auth');

const normalizePhilippineContactExpression = (field) => ({
  $let: {
    vars: {
      digitMatches: {
        $regexFindAll: {
          input: { $convert: { input: field, to: 'string', onError: '', onNull: '' } },
          regex: '[0-9]'
        }
      }
    },
    in: {
      $let: {
        vars: {
          digits: {
            $reduce: {
              input: '$$digitMatches',
              initialValue: '',
              in: { $concat: ['$$value', '$$this.match'] }
            }
          }
        },
        in: {
          $cond: [
            { $regexMatch: { input: '$$digits', regex: '^0[0-9]{10}$' } },
            { $concat: ['63', { $substrCP: ['$$digits', 1, 10] }] },
            '$$digits'
          ]
        }
      }
    }
  }
});

const normalizeBorrowerIdentityExpression = () => ({
  $let: {
    vars: {
      contact: normalizePhilippineContactExpression('$contactNo'),
      name: {
        $toLower: {
          $trim: {
            input: {
              $cond: [
                {
                  $ne: [
                    { $trim: { input: { $ifNull: ['$fullname', ''] } } },
                    ''
                  ]
                },
                '$fullname',
                { $ifNull: ['$Name', ''] }
              ]
            }
          }
        }
      }
    },
    in: {
      $cond: [
        { $ne: ['$$contact', ''] },
        { $concat: ['contact:', '$$contact'] },
        { $concat: ['name:', '$$name'] }
      ]
    }
  }
});

const ANALYTICS_TIME_ZONE = 'Asia/Manila';
const INVALID_BORROWING_STATUS = /(cancelled|canceled|invalid|rejected|void|deleted)/i;
const BORROWER_TYPES = ['Student', 'Faculty', 'Coach/Trainer', 'Others (Office/Agency)'];

const formatCalendarDate = (year, month, day) => (
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
);

const getManilaDateParts = (date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ANALYTICS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
};

const parseSelectedDate = (period, selectedDate, now = new Date()) => {
  const parts = getManilaDateParts(now);
  const defaultDate = period === 'yearly'
    ? parts.year
    : period === 'monthly'
      ? `${parts.year}-${parts.month}`
      : `${parts.year}-${parts.month}-${parts.day}`;
  const value = selectedDate || defaultDate;
  if (typeof value !== 'string') return null;
  const pattern = period === 'yearly'
    ? /^(\d{4})$/
    : period === 'monthly'
      ? /^(\d{4})-(\d{2})$/
      : /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = value.match(pattern);
  if (!match) return null;

  const year = Number(match[1]);
  const month = period === 'yearly' ? 1 : Number(match[2]);
  const day = ['daily', 'weekly'].includes(period) ? Number(match[3]) : 1;
  const validationDate = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1000
    || validationDate.getUTCFullYear() !== year
    || validationDate.getUTCMonth() !== month - 1
    || validationDate.getUTCDate() !== day
  ) return null;

  return { year, month, day, value };
};

const getAnalyticsRange = (period, selectedDate, now = new Date()) => {
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(period)) return null;
  const selected = parseSelectedDate(period, selectedDate, now);
  if (!selected) return null;

  let { year, month, day } = selected;
  if (period === 'weekly') {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const mondayOffset = (weekday + 6) % 7;
    const monday = new Date(Date.UTC(year, month - 1, day - mondayOffset));
    year = monday.getUTCFullYear();
    month = monday.getUTCMonth() + 1;
    day = monday.getUTCDate();
  } else if (period === 'monthly') {
    day = 1;
  } else if (period === 'yearly') {
    month = 1;
    day = 1;
  }

  const startCalendar = new Date(Date.UTC(year, month - 1, day));
  const endCalendar = new Date(startCalendar);
  if (period === 'daily') endCalendar.setUTCDate(endCalendar.getUTCDate() + 1);
  if (period === 'weekly') endCalendar.setUTCDate(endCalendar.getUTCDate() + 7);
  if (period === 'monthly') endCalendar.setUTCMonth(endCalendar.getUTCMonth() + 1);
  if (period === 'yearly') endCalendar.setUTCFullYear(endCalendar.getUTCFullYear() + 1);

  const previousStart = new Date(startCalendar);
  const previousEnd = new Date(endCalendar);
  if (period === 'daily') previousStart.setUTCDate(previousStart.getUTCDate() - 1);
  if (period === 'weekly') previousStart.setUTCDate(previousStart.getUTCDate() - 7);
  if (period === 'monthly') previousStart.setUTCMonth(previousStart.getUTCMonth() - 1);
  if (period === 'yearly') previousStart.setUTCFullYear(previousStart.getUTCFullYear() - 1);
  previousEnd.setTime(startCalendar.getTime());

  const toManilaMidnight = (date) => new Date(date.getTime() - (8 * 60 * 60 * 1000));
  const toRange = (start, end) => ({
    start: toManilaMidnight(start),
    end: toManilaMidnight(end),
    startDate: formatCalendarDate(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()),
    endDate: formatCalendarDate(
      new Date(end.getTime() - 86400000).getUTCFullYear(),
      new Date(end.getTime() - 86400000).getUTCMonth() + 1,
      new Date(end.getTime() - 86400000).getUTCDate()
    )
  });

  return {
    period,
    selectedDate: selected.value,
    timeZone: ANALYTICS_TIME_ZONE,
    current: toRange(startCalendar, endCalendar),
    previous: toRange(previousStart, previousEnd),
    bucketFormat: period === 'daily' ? '%H' : period === 'yearly' ? '%Y-%m' : '%Y-%m-%d'
  };
};

const getStudentAthleteDateMatch = (range) => ({
  createdAt: { $gte: range.start, $lt: range.end }
});

const getBorrowingDateMatch = (range) => ({
  $and: [
    { status: { $not: INVALID_BORROWING_STATUS } },
    {
      $or: [
        { borrowDate: { $gte: range.start, $lt: range.end } },
        {
          $and: [
            { $or: [{ borrowDate: null }, { borrowDate: { $exists: false } }] },
            { createdAt: { $gte: range.start, $lt: range.end } }
          ]
        }
      ]
    }
  ]
});

const getBucketExpression = (format, dateField) => ({
  $dateToString: {
    format,
    date: dateField,
    timezone: ANALYTICS_TIME_ZONE
  }
});

const buildEquipmentLineStages = (bucketFormat) => [
  {
    $project: {
      analyticsBucket: getBucketExpression(bucketFormat, '$analyticsDate'),
      equipmentItemsForAnalytics: {
        $cond: [
          { $gt: [{ $size: { $ifNull: ['$equipmentItems', []] } }, 0] },
          {
            $map: {
              input: { $ifNull: ['$equipmentItems', []] },
              as: 'item',
              in: {
                name: { $trim: { input: { $ifNull: ['$$item.equipment', ''] } } },
                referenceIds: { $setUnion: [{ $ifNull: ['$$item.referenceIds', []] }, []] },
                quantity: { $convert: { input: '$$item.quantity', to: 'int', onError: 0, onNull: 0 } }
              }
            }
          },
          [{
            name: { $trim: { input: { $ifNull: ['$equipment', ''] } } },
            referenceIds: { $setUnion: [{ $ifNull: ['$referenceIds', []] }, []] },
            quantity: {
              $convert: {
                input: { $ifNull: ['$quantity', '$qty'] },
                to: 'int',
                onError: 0,
                onNull: 0
              }
            }
          }]
        ]
      }
    }
  },
  { $unwind: '$equipmentItemsForAnalytics' },
  {
    $lookup: {
      from: Equipment.collection.name,
      let: { referenceIds: '$equipmentItemsForAnalytics.referenceIds' },
      pipeline: [
        { $match: { $expr: { $in: ['$referenceId', '$$referenceIds'] } } },
        { $project: { name: 1 } }
      ],
      as: 'equipmentReferences'
    }
  },
  {
    $addFields: {
      equipmentItemsForAnalytics: {
        $mergeObjects: [
          '$equipmentItemsForAnalytics',
          {
            name: {
              $cond: [
                { $ne: ['$equipmentItemsForAnalytics.name', ''] },
                '$equipmentItemsForAnalytics.name',
                { $ifNull: [{ $arrayElemAt: ['$equipmentReferences.name', 0] }, ''] }
              ]
            }
          }
        ]
      }
    }
  },
  {
    $addFields: {
      'equipmentItemsForAnalytics.key': {
        $toLower: { $trim: { input: '$equipmentItemsForAnalytics.name' } }
      }
    }
  },
  { $match: { 'equipmentItemsForAnalytics.key': { $ne: '' } } },
  {
    $group: {
      _id: { transaction: '$_id', equipment: '$equipmentItemsForAnalytics.key' },
      equipment: { $first: '$equipmentItemsForAnalytics.name' },
      period: { $first: '$analyticsBucket' },
      referenceIdGroups: { $push: '$equipmentItemsForAnalytics.referenceIds' },
      fallbackQuantity: {
        $sum: {
          $cond: [
            { $eq: [{ $size: '$equipmentItemsForAnalytics.referenceIds' }, 0] },
            '$equipmentItemsForAnalytics.quantity',
            0
          ]
        }
      }
    }
  },
  {
    $project: {
      _id: 1,
      equipment: 1,
      period: 1,
      fallbackQuantity: 1,
      uniqueReferenceIds: {
        $setUnion: [
          {
            $reduce: {
              input: '$referenceIdGroups',
              initialValue: [],
              in: { $concatArrays: ['$$value', '$$this'] }
            }
          },
          []
        ]
      }
    }
  },
  {
    $addFields: {
      quantity: { $add: [{ $size: '$uniqueReferenceIds' }, '$fallbackQuantity'] }
    }
  },
  { $match: { quantity: { $gt: 0 } } }
];

// @desc    Get admin dashboard stats
// @route   GET /api/v1/admin/dashboard
// @access  Private/Admin
router.get('/admin/dashboard', protect, authorize('admin'), async (req, res) => {
  try {
    const analyticsPeriod = getAnalyticsRange(
      req.query?.period || 'yearly',
      req.query?.date
    );
    if (!analyticsPeriod) {
      return res.status(400).json({ message: 'Choose a valid daily, weekly, monthly, or yearly reporting period.' });
    }

    // Users
    const totalUsers = await User.countDocuments();
    const totalAthletes = await User.countDocuments({ role: 'student' });
    const totalCoaches = await User.countDocuments({ role: 'coach' });
    // Equipments
    const totalEquipments = await Equipment.countDocuments();

    // Borrowed items: count borrowings that are currently out (statuses indicating active loan)
    // Use case-insensitive matching to be resilient to status casing/variants in DB
    const borrowedStatuses = ['Out Now', 'Out', 'Overdue', 'Borrowed', 'Checked Out'];
    const borrowedItems = await Borrowing.countDocuments({
      $or: [
        { status: { $in: borrowedStatuses } },
        { status: { $regex: /(out now|out|overdue|borrowed|checked out)/i } }
      ]
    });

    // Pending gymnasium schedule requests (case-insensitive match)
    const pendingRequirements = await ScheduleRequest.countDocuments({ status: { $regex: /^pending$/i } });

    // Recent activities (derive from latest users)
    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('fullname role createdAt');

    const activities = recentUsers.map(user => ({
      id: `user-${user._id}`,
      action: `New ${user.role} registered: ${user.fullname}`,
      time: getTimeAgo(user.createdAt)
    }));

    const [studentAthletesByDepartment, borrowingsByDepartment, equipmentBorrowingFrequency] = await Promise.all([
      StudentAthlete.aggregate([
        { $match: getStudentAthleteDateMatch(analyticsPeriod.current) },
        {
          $group: {
            _id: {
              $let: {
                vars: { department: { $trim: { input: { $ifNull: ['$department', ''] } } } },
                in: {
                  $cond: [
                    { $eq: ['$$department', ''] },
                    'Department not provided',
                    '$$department'
                  ]
                }
              }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1, _id: 1 } },
        { $project: { _id: 0, department: '$_id', count: 1 } }
      ]),
      Borrowing.aggregate([
        { $match: getBorrowingDateMatch(analyticsPeriod.current) },
        { $match: { borrowerType: { $in: [...BORROWER_TYPES, '', null] } } },
        {
          $lookup: {
            from: User.collection.name,
            let: {
              borrowerContact: normalizePhilippineContactExpression('$contactNo')
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $ne: ['$$borrowerContact', ''] },
                      { $in: ['$role', ['student', 'coach']] },
                      {
                        $eq: [
                          normalizePhilippineContactExpression('$contactNumber'),
                          '$$borrowerContact'
                        ]
                      }
                    ]
                  }
                }
              },
              { $limit: 2 },
              { $project: { department: 1, role: 1 } }
            ],
            as: 'matchedUsers'
          }
        },
        {
          $lookup: {
            from: StudentAthlete.collection.name,
            let: {
              borrowerContact: normalizePhilippineContactExpression('$contactNo')
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $ne: ['$$borrowerContact', ''] },
                      {
                        $eq: [
                          normalizePhilippineContactExpression('$contactNumber'),
                          '$$borrowerContact'
                        ]
                      }
                    ]
                  }
                }
              },
              { $limit: 2 },
              { $project: { department: 1 } }
            ],
            as: 'matchedStudentAthletes'
          }
        },
        {
          $addFields: {
            matchedUser: {
              $cond: [
                { $eq: [{ $size: '$matchedUsers' }, 1] },
                { $arrayElemAt: ['$matchedUsers', 0] },
                null
              ]
            },
            matchedStudentAthlete: {
              $cond: [
                {
                  $and: [
                    {
                      $or: [
                        { $eq: [{ $size: '$matchedUsers' }, 0] },
                        {
                          $and: [
                            { $eq: [{ $size: '$matchedUsers' }, 1] },
                            { $eq: [{ $arrayElemAt: ['$matchedUsers.role', 0] }, 'student'] },
                            {
                              $eq: [
                                { $trim: { input: { $ifNull: [{ $arrayElemAt: ['$matchedUsers.department', 0] }, ''] } } },
                                ''
                              ]
                            }
                          ]
                        }
                      ]
                    },
                    { $eq: [{ $size: '$matchedStudentAthletes' }, 1] }
                  ]
                },
                { $arrayElemAt: ['$matchedStudentAthletes', 0] },
                null
              ]
            }
          }
        },
        {
          $addFields: {
            analyticsDepartment: {
              $switch: {
                branches: [
                  {
                    case: { $eq: ['$borrowerType', 'Student'] },
                    then: {
                      $cond: [
                        { $eq: ['$matchedUser.role', 'student'] },
                        {
                          $cond: [
                            {
                              $eq: [
                                { $trim: { input: { $ifNull: ['$matchedUser.department', ''] } } },
                                ''
                              ]
                            },
                            { $ifNull: ['$matchedStudentAthlete.department', ''] },
                            '$matchedUser.department'
                          ]
                        },
                        {
                          $cond: [
                            { $eq: ['$matchedUser', null] },
                            { $ifNull: ['$matchedStudentAthlete.department', ''] },
                            ''
                          ]
                        }
                      ]
                    }
                  },
                  {
                    case: { $eq: ['$borrowerType', 'Coach/Trainer'] },
                    then: {
                      $cond: [
                        { $eq: ['$matchedUser.role', 'coach'] },
                        { $ifNull: ['$matchedUser.department', ''] },
                        ''
                      ]
                    }
                  },
                  {
                    case: { $eq: ['$borrowerType', 'Faculty'] },
                    then: ''
                  }
                ],
                default: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ['$matchedUser', null] },
                        {
                          $ne: [
                            { $trim: { input: { $ifNull: ['$matchedUser.department', ''] } } },
                            ''
                          ]
                        }
                      ]
                    },
                    '$matchedUser.department',
                    { $ifNull: ['$matchedStudentAthlete.department', ''] }
                  ]
                }
              }
            }
          }
        },
        {
          $match: {
            $or: [
              { borrowerType: { $in: BORROWER_TYPES } },
              {
                borrowerType: { $in: ['', null] },
                $or: [
                  { 'matchedUser.role': { $in: ['student', 'coach'] } },
                  { matchedStudentAthlete: { $ne: null } }
                ]
              }
            ]
          }
        },
        {
          $group: {
            _id: {
              $let: {
                vars: {
                  department: {
                    $trim: { input: { $ifNull: ['$analyticsDepartment', ''] } }
                  }
                },
                in: {
                  $cond: [
                    { $eq: ['$$department', ''] },
                    'Department unavailable',
                    '$$department'
                  ]
                }
              }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1, _id: 1 } },
        { $project: { _id: 0, department: '$_id', count: 1 } }
      ]),
      Borrowing.aggregate([
        { $match: getBorrowingDateMatch(analyticsPeriod.current) },
        {
          $project: {
            equipmentItemsForAnalytics: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ['$equipmentItems', []] } }, 0] },
                {
                  $map: {
                    input: { $ifNull: ['$equipmentItems', []] },
                    as: 'item',
                    in: {
                      name: { $trim: { input: { $ifNull: ['$$item.equipment', ''] } } },
                      key: {
                        $toLower: { $trim: { input: { $ifNull: ['$$item.equipment', ''] } } }
                      },
                      referenceIds: {
                        $setUnion: [{ $ifNull: ['$$item.referenceIds', []] }, []]
                      },
                      quantity: {
                        $convert: { input: '$$item.quantity', to: 'int', onError: 0, onNull: 0 }
                      }
                    }
                  }
                },
                [
                  {
                    name: { $trim: { input: { $ifNull: ['$equipment', ''] } } },
                    key: {
                      $toLower: { $trim: { input: { $ifNull: ['$equipment', ''] } } }
                    },
                    referenceIds: {
                      $setUnion: [{ $ifNull: ['$referenceIds', []] }, []]
                    },
                    quantity: {
                      $convert: {
                        input: { $ifNull: ['$quantity', '$qty'] },
                        to: 'int',
                        onError: 0,
                        onNull: 0
                      }
                    }
                  }
                ]
              ]
            }
          }
        },
        { $unwind: '$equipmentItemsForAnalytics' },
        {
          $lookup: {
            from: Equipment.collection.name,
            let: { referenceIds: '$equipmentItemsForAnalytics.referenceIds' },
            pipeline: [
              {
                $match: {
                  $expr: { $in: ['$referenceId', '$$referenceIds'] }
                }
              },
              { $project: { name: 1 } }
            ],
            as: 'equipmentReferences'
          }
        },
        {
          $addFields: {
            equipmentItemsForAnalytics: {
              $mergeObjects: [
                '$equipmentItemsForAnalytics',
                {
                  name: {
                    $cond: [
                      { $ne: ['$equipmentItemsForAnalytics.name', ''] },
                      '$equipmentItemsForAnalytics.name',
                      { $ifNull: [{ $arrayElemAt: ['$equipmentReferences.name', 0] }, ''] }
                    ]
                  }
                }
              ]
            }
          }
        },
        {
          $addFields: {
            'equipmentItemsForAnalytics.key': {
              $toLower: { $trim: { input: '$equipmentItemsForAnalytics.name' } }
            }
          }
        },
        { $match: { 'equipmentItemsForAnalytics.key': { $ne: '' } } },
        {
          $group: {
            _id: { transaction: '$_id', equipment: '$equipmentItemsForAnalytics.key' },
            equipment: { $first: '$equipmentItemsForAnalytics.name' },
            referenceIdGroups: { $push: '$equipmentItemsForAnalytics.referenceIds' },
            fallbackQuantity: {
              $sum: {
                $cond: [
                  { $eq: [{ $size: '$equipmentItemsForAnalytics.referenceIds' }, 0] },
                  '$equipmentItemsForAnalytics.quantity',
                  0
                ]
              }
            }
          }
        },
        {
          $project: {
            _id: 1,
            equipment: 1,
            fallbackQuantity: 1,
            uniqueReferenceIds: {
              $setUnion: [
                {
                  $reduce: {
                    input: '$referenceIdGroups',
                    initialValue: [],
                    in: { $concatArrays: ['$$value', '$$this'] }
                  }
                },
                []
              ]
            }
          }
        },
        {
          $addFields: {
            quantity: { $add: [{ $size: '$uniqueReferenceIds' }, '$fallbackQuantity'] }
          }
        },
        { $match: { quantity: { $gt: 0 } } },
        {
          $group: {
            _id: '$_id.equipment',
            equipment: { $first: '$equipment' },
            count: { $sum: '$quantity' },
            transactions: { $sum: 1 },
            referenceIdGroups: { $push: '$uniqueReferenceIds' }
          }
        },
        {
          $addFields: {
            referenceIds: {
              $setUnion: [
                {
                  $reduce: {
                    input: '$referenceIdGroups',
                    initialValue: [],
                    in: { $concatArrays: ['$$value', '$$this'] }
                  }
                },
                []
              ]
            }
          }
        },
        { $addFields: { referenceIdCount: { $size: '$referenceIds' } } },
        { $sort: { count: -1, _id: 1 } },
        { $project: { _id: 0, equipment: 1, count: 1, transactions: 1, referenceIds: 1, referenceIdCount: 1 } }
      ])
    ]);

    const [
      studentAthleteRegistrationTrend,
      previousStudentAthletesRegistered,
      totalRegisteredStudentAthletes,
      borrowerTypeActivity,
      borrowingTrend,
      equipmentBorrowingTrend,
      totalBorrowingTransactions,
      previousBorrowingTransactions
    ] = await Promise.all([
      StudentAthlete.aggregate([
        { $match: getStudentAthleteDateMatch(analyticsPeriod.current) },
        {
          $group: {
            _id: getBucketExpression(analyticsPeriod.bucketFormat, '$createdAt'),
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, period: '$_id', count: 1 } }
      ]),
      StudentAthlete.countDocuments(getStudentAthleteDateMatch(analyticsPeriod.previous)),
      StudentAthlete.countDocuments(),
      Borrowing.aggregate([
        { $match: getBorrowingDateMatch(analyticsPeriod.current) },
        { $match: { borrowerType: { $in: BORROWER_TYPES } } },
        {
          $group: {
            _id: {
              type: '$borrowerType',
              borrower: normalizeBorrowerIdentityExpression()
            },
            transactions: { $sum: 1 }
          }
        },
        {
          $group: {
            _id: '$_id.type',
            transactions: { $sum: '$transactions' },
            borrowers: { $sum: { $cond: [{ $ne: ['$_id.borrower', 'name:'] }, 1, 0] } }
          }
        },
        { $sort: { transactions: -1, _id: 1 } },
        {
          $project: {
            _id: 0,
            borrowerType: '$_id',
            count: '$transactions',
            transactions: 1,
            borrowers: 1
          }
        }
      ]),
      Borrowing.aggregate([
        { $match: getBorrowingDateMatch(analyticsPeriod.current) },
        { $set: { analyticsDate: { $ifNull: ['$borrowDate', '$createdAt'] } } },
        {
          $group: {
            _id: getBucketExpression(analyticsPeriod.bucketFormat, '$analyticsDate'),
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, period: '$_id', count: 1 } }
      ]),
      Borrowing.aggregate([
        { $match: getBorrowingDateMatch(analyticsPeriod.current) },
        { $set: { analyticsDate: { $ifNull: ['$borrowDate', '$createdAt'] } } },
        ...buildEquipmentLineStages(analyticsPeriod.bucketFormat),
        {
          $group: {
            _id: '$period',
            count: { $sum: '$quantity' }
          }
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, period: '$_id', count: 1 } }
      ]),
      Borrowing.countDocuments(getBorrowingDateMatch(analyticsPeriod.current)),
      Borrowing.countDocuments(getBorrowingDateMatch(analyticsPeriod.previous))
    ]);

    // Upcoming schedules: get active upcoming schedules from MongoDB
    const today = new Date().toISOString().split('T')[0];
    let upcomingSchedules = [];
    try {
      upcomingSchedules = await Schedule.find({
        status: { $regex: /^active$/i },
        $or: [
          { startDate: { $gte: today } },
          { endDate: { $gte: today } }
        ]
      })
        .sort({ startDate: 1, startTime: 1 })
        .limit(10)
        .lean();
    } catch (scheduleError) {
      console.warn('Failed to fetch upcoming schedules for dashboard:', scheduleError.message || scheduleError);
      upcomingSchedules = [];
    }

    // Return top-level keys so frontend can read data.totalUsers etc.
    res.json({
      totalUsers,
      totalAthletes,
      totalCoaches,
      totalEquipments,
      borrowedItems,
      pendingRequirements,
      analytics: {
        studentAthletesByDepartment,
        borrowingsByDepartment,
        equipmentBorrowingFrequency,
        totalBorrowingTransactions,
        totalRegisteredStudentAthletes,
        studentAthletesRegisteredInPeriod: studentAthletesByDepartment.reduce((sum, item) => sum + item.count, 0),
        previousStudentAthletesRegistered,
        previousBorrowingTransactions,
        borrowerTypeActivity,
        studentAthleteRegistrationTrend,
        borrowingTrend,
        equipmentBorrowingTrend,
        period: {
          type: analyticsPeriod.period,
          selectedDate: analyticsPeriod.selectedDate,
          startDate: analyticsPeriod.current.startDate,
          endDate: analyticsPeriod.current.endDate,
          previousStartDate: analyticsPeriod.previous.startDate,
          previousEndDate: analyticsPeriod.previous.endDate,
          timeZone: analyticsPeriod.timeZone
        }
      },
      activities: activities.slice(0, 5),
      upcomingSchedules
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ message: 'An unexpected server error occurred. Please try again.' });
  }
});

// Helper function to get time ago
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + ' years ago';
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + ' months ago';
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + ' days ago';
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + ' hours ago';
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + ' minutes ago';
  return Math.floor(seconds) + ' seconds ago';
}

const findUserByIdentifier = async (identifier) => {
  const query = mongoose.Types.ObjectId.isValid(identifier)
    ? { $or: [{ id: identifier }, { _id: identifier }] }
    : { id: identifier };
  return User.findOne(query);
};

const sanitizeUserForAdminResponse = (user) => {
  const userObject = user?.toObject ? user.toObject() : user;
  const role = String(userObject?.role || '').trim().toLowerCase();

  if (role === 'admin') {
    return {
      _id: userObject._id,
      fullname: userObject.fullname,
      username: userObject.username,
      email: userObject.email || '',
      role,
      id: userObject.id
    };
  }

  const response = { ...userObject };

  if (response?.password !== undefined) {
    delete response.password;
  }

  delete response.department;
  delete response.sport;

  return response;
};

// NOTE: User management endpoints are centralized in `userRoutes` (mounted at `${BASE_URI}/users`).
// The admin dashboard and other admin-only endpoints remain in this file.

module.exports = router;