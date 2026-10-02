const CoachFormHeader = require('../models/CoachFormHeader');
const CoachEligibilityRequirements = require('../models/CoachEligibilityRequirements');
const CoachSportsDirector = require('../models/CoachSportsDirector');
const defaults = require('./coachRecordDefaults');

const initializeCoachRecordContent = async () => {
  const collections = [
    [CoachFormHeader, defaults.formHeader],
    [CoachEligibilityRequirements, defaults.eligibility],
    [CoachSportsDirector, defaults.director],
  ];

  return Promise.all(collections.map(([Model, initialValues]) => Model.findOneAndUpdate(
    { _id: 'global' },
    { $setOnInsert: initialValues },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ).lean()));
};

module.exports = { initializeCoachRecordContent };
