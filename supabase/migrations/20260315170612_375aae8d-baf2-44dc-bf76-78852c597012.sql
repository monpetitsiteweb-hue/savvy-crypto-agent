
-- Reset decision pipeline data (CASCADE handles FK deps from outcomes/snapshots)
TRUNCATE TABLE decision_outcomes, decision_snapshots, decision_events RESTART IDENTITY CASCADE;

-- Reset trades
TRUNCATE TABLE mock_trades RESTART IDENTITY CASCADE;

-- Reset ML calibration
TRUNCATE TABLE calibration_metrics RESTART IDENTITY CASCADE;
TRUNCATE TABLE calibration_suggestions RESTART IDENTITY CASCADE;
