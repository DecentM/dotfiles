import QtQuick 2.2
import QtQuick.Controls 2.5
import QtQuick.Layouts 1.1
import org.kde.kirigami 2.4 as Kirigami

Item {
    id: page
    width: childrenRect.width
    height: childrenRect.height

    property alias cfg_icon: configIcon.value
    property alias cfg_showAdvancedMode: showAdvancedMode.checked
    property alias cfg_aboutThisComputerSettings: aboutThisComputerSettings.text
    property alias cfg_systemPreferencesSettings: systemPreferencesSettings.text
    property alias cfg_appStoreSettings: appStoreSettings.text
    property alias cfg_forceQuitSettings: forceQuitSettings.text
    property alias cfg_sleepSettings: sleepSettings.text
    property alias cfg_restartSettings: restartSettings.text
    property alias cfg_shutDownSettings: shutDownSettings.text
    property alias cfg_lockScreenSettings: lockScreenSettings.text
    property alias cfg_logOutSettings: logOutSettings.text

    Kirigami.FormLayout {
        anchors.left: parent.left
        anchors.right: parent.right

        ConfigIcon {
            id: configIcon
            Kirigami.FormData.label: i18nd("plasma_applet_org.kde.plasma.kickoff", "Icon:")
        }

        Column {
            anchors.left: parent.left
            Text {
                color: "white"
                text: i18n("Based on the system, substitute the commands with your own")
            }
        }

        CheckBox {
            id: showAdvancedMode
            anchors.left: parent.left
            text: i18n("Enable settings")
            checked: false
            enabled:true
        }

        TextField {
            id: aboutThisComputerSettings
            Kirigami.FormData.label: i18n("About This Computer :")
            placeholderText: i18n("kinfocenter")
            enabled: showAdvancedMode.checked
        }
        
        TextField {
            id: systemPreferencesSettings
            Kirigami.FormData.label: i18n("System Preferences :")
            placeholderText: i18n("systemsettings5")
            enabled: showAdvancedMode.checked
        }
        
        TextField {
            id: appStoreSettings
            Kirigami.FormData.label: i18n ("App Store :")
            placeholderText: i18n("plasma-discover")
            enabled: showAdvancedMode.checked
        }
        
        TextField {
            id: forceQuitSettings
            Kirigami.FormData.label: i18n ("Force Quit :")
            placeholderText: i18n("xkill")
            enabled: showAdvancedMode.checked
        }
        
        TextField {
            id: sleepSettings
            Kirigami.FormData.label: i18n ("Sleep :")
            placeholderText: i18n("systemctl suspend")
            enabled: showAdvancedMode.checked
        }
        
        TextField {
            id: restartSettings
            Kirigami.FormData.label: i18n ("Restart :")
            placeholderText: i18n("/sbin/reboot")
            enabled: showAdvancedMode.checked
        }
        
        TextField {
            id: shutDownSettings
            Kirigami.FormData.label: i18n ("Shut Down :")
            placeholderText: i18n("/sbin/shutdown now")
            enabled: showAdvancedMode.checked
        }
        
        TextField {
            id: lockScreenSettings
            Kirigami.FormData.label: i18n ("Lock Screen :")
            placeholderText: i18n("qdbus org.freedesktop.ScreenSaver /ScreenSaver Lock")
            enabled: showAdvancedMode.checked
        }
        
        TextField {
            id: logOutSettings
            Kirigami.FormData.label: i18n ("Log Out :")
            placeholderText: i18n("qdbus org.kde.ksmserver /KSMServer logout 0 0 0")
            enabled: showAdvancedMode.checked
        }
    }
}