/*
 * Sling Model for the feature-cta component: split section with heading, description, CTA and image.
 */
package com.demo.core.models;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class FeatureCtaModel {

    @ValueMapValue
    private String style;

    @ValueMapValue
    private String heading;

    @ValueMapValue
    private String description;

    @ValueMapValue
    private String ctaLabel;

    @ValueMapValue
    private String ctaLink;

    @ValueMapValue
    private String image;

    @ValueMapValue
    private String imageAlt;

    @ValueMapValue
    private String imageSide;

    @ValueMapValue
    private Boolean showDecoration;

    @ValueMapValue
    private String background;

    @ValueMapValue
    private String backgroundHex;

    public String getStyle() {
        return StringUtils.defaultIfBlank(style, "furniture");
    }

    public String getHeading() {
        return heading;
    }

    public String getDescription() {
        return description;
    }

    public String getCtaLabel() {
        return ctaLabel;
    }

    public String getCtaLink() {
        return StringUtils.defaultIfBlank(ctaLink, "#");
    }

    public String getImage() {
        return image;
    }

    public String getImageAlt() {
        return StringUtils.defaultIfBlank(imageAlt, "");
    }

    public String getImageSide() {
        return StringUtils.defaultIfBlank(imageSide, "right");
    }

    public boolean isShowDecoration() {
        return showDecoration == null || showDecoration.booleanValue();
    }

    public String getBackgroundStyle() {
        if ("other".equals(background) && StringUtils.isNotBlank(backgroundHex)) {
            String hex = backgroundHex.trim();
            if (!hex.startsWith("#")) {
                hex = "#" + hex;
            }
            return "background-color: " + hex + ";";
        }
        return null;
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(heading)
                || StringUtils.isNotBlank(description)
                || StringUtils.isNotBlank(ctaLabel)
                || StringUtils.isNotBlank(image);
    }
}
