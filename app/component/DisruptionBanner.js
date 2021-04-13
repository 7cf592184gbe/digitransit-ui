import PropTypes from 'prop-types';
import React from 'react';
import { createFragmentContainer, graphql } from 'react-relay';
import connectToStores from 'fluxible-addons-react/connectToStores';
import isEmpty from 'lodash/isEmpty';
import {
  isAlertValid,
  getServiceAlertDescription,
  getServiceAlertMetadata,
  getServiceAlertHeader,
} from '../util/alertUtils';
import DisruptionBannerAlert from './DisruptionBannerAlert';

class DisruptionBanner extends React.Component {
  static propTypes = {
    alerts: PropTypes.arrayOf(PropTypes.object),
    currentTime: PropTypes.number.isRequired,
    language: PropTypes.string.isRequired,
    mode: PropTypes.string.isRequired,
  };

  static contextTypes = {
    config: PropTypes.object.isRequired,
  };

  getAlerts() {
    const { alerts } = this.props;
    const activeAlerts = [];
    alerts.forEach(alert => {
      const currAlert = {
        ...alert,
        ...getServiceAlertMetadata(alert),
      };
      if (
        alert.route &&
        alert.route.mode === this.props.mode &&
        !isEmpty(alert.alertDescriptionText) &&
        isAlertValid(currAlert, this.props.currentTime)
      ) {
        if (
          !activeAlerts.find(
            activeAlert =>
              activeAlert.alertDescriptionText ===
              currAlert.alertDescriptionText,
          )
        ) {
          activeAlerts.push(currAlert);
        }
      }
    });
    return activeAlerts;
  }

  createAlertText(alert) {
    return getServiceAlertDescription(alert, this.props.language);
  }

  createAlertHeader(alert) {
    return getServiceAlertHeader(alert, this.props.language);
  }

  render() {
    const activeAlerts = this.getAlerts();
    if (activeAlerts.length > 0) {
      return (
        <DisruptionBannerAlert
          messages={activeAlerts.map(alert => {
            return this.createAlertText(alert);
          })}
          key={alert.id}
          //header={this.createAlertHeader(alert)}
          //message={this.createAlertText(alert)}
          language={this.props.language}
        />
      );
    }
    return null;
  }
}

const containerComponent = createFragmentContainer(
  connectToStores(
    DisruptionBanner,
    ['TimeStore', 'PreferencesStore'],
    ({ getStore }) => ({
      currentTime: getStore('TimeStore').getCurrentTime().unix(),
      language: getStore('PreferencesStore').getLanguage(),
    }),
  ),
  {
    alerts: graphql`
      fragment DisruptionBanner_alerts on Alert @relay(plural: true) {
        id
        alertSeverityLevel
        alertHeaderText
        alertEffect
        alertCause
        alertDescriptionText
        alertHeaderTextTranslations {
          text
          language
        }
        alertDescriptionTextTranslations {
          text
          language
        }
        effectiveStartDate
        effectiveEndDate
        route {
          mode
          shortName
        }
      }
    `,
  },
);

export { containerComponent as default, DisruptionBanner as Component };
